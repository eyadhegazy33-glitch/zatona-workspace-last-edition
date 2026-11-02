import type { AuthError, Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "../lib/supabase";

export type SignUpInput = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  email: string;
  password: string;
  requestedRoleId: string;
};

export type AccountStatus = "pending" | "active" | "rejected" | "suspended";

export type MyProfile = {
  id: string;
  first_name: string;
  last_name: string;
  phone_number?: string | null;
  email: string;
  requested_role_id?: string | null;
  role_id: string | null;
  status: AccountStatus;
  reject_reason: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  role: { name: string } | null;
  permissions: string[];
};

export class AuthServiceError extends Error {
  constructor(
    readonly messageKey: string,
    options?: ErrorOptions,
  ) {
    super(messageKey, options);
    this.name = "AuthServiceError";
  }
}

const profileRequests = new Map<string, Promise<MyProfile | null>>();

function toAuthServiceError(error: AuthError): AuthServiceError {
  if (error.code === "email_not_confirmed") {
    return new AuthServiceError("auth.errors.emailNotConfirmed", { cause: error });
  }

  if (error.code === "weak_password") {
    return new AuthServiceError("auth.errors.weakPassword", { cause: error });
  }

  if (
    error.status === 429 ||
    error.code === "over_request_rate_limit" ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "too_many_requests"
  ) {
    return new AuthServiceError("auth.errors.tooManyAttempts", { cause: error });
  }

  if (error.code === "invalid_credentials") {
    return new AuthServiceError("auth.errors.invalidCredentials", { cause: error });
  }

  if (error.code === "user_already_exists") {
    return new AuthServiceError("auth.errors.emailAlreadyRegistered", {
      cause: error,
    });
  }

  return new AuthServiceError("auth.errors.generic", { cause: error });
}

export function mapAuthError(error: unknown): AuthServiceError {
  if (error instanceof AuthServiceError) {
    return error;
  }

  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (typeof code === "string") {
      if (code === "weak_password") {
        return new AuthServiceError("auth.errors.weakPassword", {
          cause: error,
        });
      }

      if (code === "user_already_exists") {
        return new AuthServiceError("auth.errors.emailAlreadyRegistered", {
          cause: error,
        });
      }

      if (
        code === "over_request_rate_limit" ||
        code === "over_email_send_rate_limit" ||
        code === "too_many_requests"
      ) {
        return new AuthServiceError("auth.errors.tooManyAttempts", {
          cause: error,
        });
      }
    }
  }

  if (error instanceof Error) {
    if (/missing supabase configuration/i.test(error.message)) {
      return new AuthServiceError("auth.errors.supabaseNotConfigured", {
        cause: error,
      });
    }

    if (
      error.name === "AuthRetryableFetchError" ||
      error.name === "TypeError" ||
      /network|fetch failed/i.test(error.message)
    ) {
      return new AuthServiceError("auth.errors.network", { cause: error });
    }
  }

  return new AuthServiceError("auth.errors.generic", {
    cause: error instanceof Error ? error : undefined,
  });
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ user: User; session: Session }> {
  try {
    const { data, error } = await getSupabaseClient().auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw toAuthServiceError(error);
    }

    if (!data.user || !data.session) {
      throw new AuthServiceError("auth.errors.generic");
    }

    return { user: data.user, session: data.session };
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function signUp(
  input: SignUpInput,
): Promise<{ user: User | null; session: Session | null }> {
  try {
    const { data, error } = await getSupabaseClient().auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          first_name: input.firstName,
          last_name: input.lastName,
          phone_number: input.phoneNumber,
          requested_role_id: input.requestedRoleId,
        },
      },
    });

    if (error) {
      throw toAuthServiceError(error);
    }

    return data;
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function signOut(): Promise<void> {
  try {
    const { error } = await getSupabaseClient().auth.signOut();

    if (error) {
      throw toAuthServiceError(error);
    }
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function sendPasswordReset(
  email: string,
): Promise<void> {
  try {
    const { error } = await getSupabaseClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      throw toAuthServiceError(error);
    }
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function updatePassword(password: string): Promise<void> {
  try {
    const { error } = await getSupabaseClient().auth.updateUser({ password });

    if (error) {
      throw toAuthServiceError(error);
    }
  } catch (error) {
    throw mapAuthError(error);
  }
}

export async function getMyProfile(
  userId?: string,
): Promise<MyProfile | null> {
  if (userId) return getProfileForUser(userId);

  const {
    data: { session },
    error,
  } = await getSupabaseClient().auth.getSession();
  if (error) {
    throw new AuthServiceError("auth.errors.generic", { cause: error });
  }
  return session ? getProfileForUser(session.user.id) : null;
}

export function getProfileForUser(userId: string): Promise<MyProfile | null> {
  const existingRequest = profileRequests.get(userId);
  if (existingRequest) {
    return existingRequest;
  }

  const request = fetchProfileForUser(userId);
  profileRequests.set(userId, request);
  void request.then(
    () => {
      if (profileRequests.get(userId) === request) {
        profileRequests.delete(userId);
      }
    },
    () => {
      if (profileRequests.get(userId) === request) {
        profileRequests.delete(userId);
      }
    },
  );
  return request;
}

async function fetchProfileForUser(userId: string): Promise<MyProfile | null> {
  const { data, error } = await getSupabaseClient().rpc("get_my_access");

  if (error) {
    if (("status" in error && error.status === 401) || error.code === "401") {
      throw new AuthServiceError("auth.errors.profileUnavailable", {
        cause: error,
      });
    }
    throw new AuthServiceError("auth.errors.profileUnavailable", {
      cause: error,
    });
  }

  if (!data) {
    return null;
  }

  const row = data as unknown as {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    status: AccountStatus;
    reject_reason: string | null;
    role_id: string | null;
    role_name: string | null;
    permissions: string[] | null;
  };
  if (!row.id || row.id !== userId || !row.status) return null;
  return {
    ...row,
    role: row.role_name ? { name: row.role_name } : null,
    permissions: Array.isArray(row.permissions) ? row.permissions : [],
  };
}
