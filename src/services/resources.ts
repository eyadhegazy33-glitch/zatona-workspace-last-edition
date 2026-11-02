import type { Database } from "../lib/database.types";
import { unwrap } from "../lib/db";
import { getSupabaseClient } from "../lib/supabase";

export type ResourceType = "seat" | "room" | "table";
export type ResourceStatus = "available" | "maintenance";

export type Resource = {
  id: string;
  type: ResourceType;
  name: string;
  capacity: number;
  status: ResourceStatus;
  active: boolean;
  created_at: string;
  occupancy: number;
};

export type ResourceInput = {
  type: ResourceType;
  name: string;
  capacity: number;
  status: ResourceStatus;
  active: boolean;
};

export type ResourceOccupancy = {
  resources: Resource[];
  occupancyByResource: Record<string, number>;
};

export type BulkCreateResourcesResult = {
  created: number;
  skipped: number;
};

export type ResourceCustomerCandidate = {
  id: string;
  code: string;
  first_name: string;
  last_name: string;
  checkinId: number | null;
  resourceId: string | null;
};

export async function listResources(): Promise<ResourceOccupancy> {
  const client = getSupabaseClient();
  const [resourceRows, checkinRows] = await Promise.all([
    client
      .from("resources")
      .select("id, type, name, capacity, status, active, created_at")
      .order("type")
      .order("name"),
    client.from("checkins").select("resource_id").is("checked_out_at", null),
  ]);
  const resources = unwrap(resourceRows);
  const openCheckins = unwrap(checkinRows);
  if (!resources || !openCheckins) {
    throw new Error("Resource or occupancy query returned no data.");
  }
  const occupancyByResource: Record<string, number> = {};

  for (const { resource_id: resourceId } of openCheckins) {
    if (resourceId) {
      occupancyByResource[resourceId] =
        (occupancyByResource[resourceId] ?? 0) + 1;
    }
  }

  return {
    resources: resources.map((resource) => ({
      ...resource,
      occupancy: occupancyByResource[resource.id] ?? 0,
    })),
    occupancyByResource,
  };
}

export async function createResource(input: ResourceInput): Promise<void> {
  const result = await getSupabaseClient()
    .from("resources")
    .insert({
      type: input.type,
      name: input.name.trim(),
      capacity: input.capacity,
      status: input.status,
      active: input.active,
    });
  unwrap(result);
}

export async function updateResource(
  resourceId: string,
  input: ResourceInput,
): Promise<void> {
  const result = await getSupabaseClient()
    .from("resources")
    .update({
      type: input.type,
      name: input.name.trim(),
      capacity: input.capacity,
      status: input.status,
      active: input.active,
    })
    .eq("id", resourceId);
  unwrap(result);
}

export async function deleteResource(resourceId: string): Promise<void> {
  const result = await getSupabaseClient().rpc("delete_resource", {
    p_resource: resourceId,
  });
  unwrap(result);
}

export async function bulkCreateResources(
  type: ResourceType,
  prefix: string,
  count: number,
  capacity: number,
): Promise<BulkCreateResourcesResult> {
  if (!Number.isInteger(count) || count < 1 || count > 200) {
    throw new RangeError("Resource count must be between 1 and 200.");
  }
  const cleanPrefix = prefix.trim();
  if (!cleanPrefix || cleanPrefix.length > 56) {
    throw new RangeError("Resource prefix must contain 1 to 56 characters.");
  }
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 200) {
    throw new RangeError("Resource capacity must be between 1 and 200.");
  }
  const rows: Database["public"]["Tables"]["resources"]["Insert"][] =
    Array.from({ length: count }, (_, index) => ({
      type,
      name: `${cleanPrefix} ${index + 1}`,
      capacity,
    }));
  const result = await getSupabaseClient()
    .from("resources")
    .upsert(rows, {
      onConflict: "type,name",
      ignoreDuplicates: true,
    })
    .select("id");
  const createdRows = unwrap(result);
  if (!createdRows) {
    throw new Error("Bulk resource creation returned no result.");
  }
  const created = createdRows.length;

  return { created, skipped: count - created };
}

export async function searchResourceCustomers(
  search: string,
): Promise<ResourceCustomerCandidate[]> {
  const term = search.trim();
  if (!term) return [];
  const escaped = term.replace(/[\\%_,()."]/g, "\\$&");
  const client = getSupabaseClient();
  const customerRows = await client
    .from("customers")
    .select("id, code, first_name, last_name")
    .is("deleted_at", null)
    .or(
      `full_name.ilike.%${escaped}%,code.ilike.%${escaped}%,phone.ilike.%${escaped}%`,
    )
    .order("last_name")
    .order("first_name")
    .limit(20);
  const customers = unwrap(customerRows);
  if (!customers?.length) return [];

  const openCheckinRows = await client
    .from("checkins")
    .select("id, customer_id, resource_id")
    .in(
      "customer_id",
      customers.map((customer) => customer.id),
    )
    .is("checked_out_at", null);
  const checkins = unwrap(openCheckinRows);
  const checkinByCustomer = new Map(
    (checkins ?? []).map((checkin) => [checkin.customer_id, checkin]),
  );

  return customers.map((customer) => {
    const checkin = checkinByCustomer.get(customer.id);
    return {
      ...customer,
      checkinId: checkin?.id ?? null,
      resourceId: checkin?.resource_id ?? null,
    };
  });
}

export async function checkInCustomerToResource(
  customerId: string,
  resourceId: string | null,
): Promise<void> {
  const result = await getSupabaseClient().rpc("check_in", {
    p_customer: customerId,
    p_resource: resourceId,
  });
  unwrap(result);
}

export async function assignCustomerToResource(
  checkinId: number,
  resourceId: string,
): Promise<void> {
  const result = await getSupabaseClient().rpc("assign_customer_resource", {
    p_checkin: checkinId,
    p_resource: resourceId,
  });
  unwrap(result);
}
