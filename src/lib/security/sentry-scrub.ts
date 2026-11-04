export function scrubSentryEvent<T extends object>(event: T): T {
  Reflect.deleteProperty(event, "user");
  Reflect.deleteProperty(event, "extra");
  Reflect.deleteProperty(event, "contexts");
  Reflect.deleteProperty(event, "message");
  Reflect.deleteProperty(event, "logentry");

  const request = Reflect.get(event, "request");
  if (request && typeof request === "object") {
    Reflect.deleteProperty(request, "cookies");
    Reflect.deleteProperty(request, "data");
    Reflect.deleteProperty(request, "headers");
    Reflect.deleteProperty(request, "query_string");

    const url = Reflect.get(request, "url");
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);
        Reflect.set(request, "url", `${parsed.origin}${parsed.pathname}`);
      } catch {
        Reflect.set(request, "url", "[redacted]");
      }
    }
  }

  const breadcrumbs = Reflect.get(event, "breadcrumbs");
  if (Array.isArray(breadcrumbs)) {
    for (const breadcrumb of breadcrumbs) {
      if (breadcrumb && typeof breadcrumb === "object") {
        Reflect.deleteProperty(breadcrumb, "data");
        Reflect.deleteProperty(breadcrumb, "message");
      }
    }
  }

  const exception = Reflect.get(event, "exception");
  const values = exception && Reflect.get(exception, "values");
  if (Array.isArray(values)) {
    for (const value of values) {
      if (value && typeof value === "object") {
        Reflect.deleteProperty(value, "value");
      }
    }
  }

  return event;
}
