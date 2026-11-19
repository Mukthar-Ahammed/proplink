export type ApiError = {
  message: string;
  retryAfterSeconds?: number;
};

export async function readApiError(response: Response): Promise<ApiError> {
  const data = await response.json().catch(() => null);
  if (response.status === 429) {
    const headerValue = Number(response.headers.get("Retry-After"));
    const bodyValue = Number(data?.retryAfterSeconds);
    const retryAfterSeconds =
      Number.isFinite(bodyValue) && bodyValue > 0
        ? Math.ceil(bodyValue)
        : Number.isFinite(headerValue) && headerValue > 0
          ? Math.ceil(headerValue)
          : undefined;
    return {
      message: "Too many requests. Please wait before trying again.",
      retryAfterSeconds,
    };
  }
  if (data?.issues) {
    const first = Object.values(data.issues as Record<string, string[]>)
      .flat()
      .find(Boolean);
    if (first) return { message: first };
  }
  return { message: data?.error ?? `Request failed (${response.status})` };
}
