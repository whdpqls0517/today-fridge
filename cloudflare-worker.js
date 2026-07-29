export default {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname.startsWith("/api/")) {
      if (!env.BACKEND_ORIGIN) {
        return Response.json(
          { success: false, error: "백엔드 주소가 설정되지 않았습니다." },
          { status: 503 }
        );
      }

      const backendUrl = new URL(incomingUrl.pathname + incomingUrl.search, env.BACKEND_ORIGIN);
      const headers = new Headers(request.headers);
      headers.set("X-Forwarded-Host", incomingUrl.host);
      headers.set("X-Forwarded-Proto", "https");

      return fetch(new Request(backendUrl, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD"
          ? undefined
          : request.body,
        redirect: "manual"
      }));
    }

    return env.ASSETS.fetch(request);
  }
};
