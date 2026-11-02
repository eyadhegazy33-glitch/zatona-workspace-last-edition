export function unwrap<T>(result: {
  data: T;
  error: unknown | null;
}): T {
  if (result.error) {
    throw result.error;
  }
  return result.data;
}
