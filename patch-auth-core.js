@
const fs = require("fs");
const path = "c:/Users/deb/enfyProjects/ATS_DOCKERREPO/ats_backend/src/auth/services/auth-core.service.ts";
let content = fs.readFileSync(path, "utf8");

const targetStr = "throw new UnauthorizedException(\"Your session has expired. Please log in again.\");\n    }";
const replacement = targetStr + `\n\n    async logoutKeycloakSession(refreshToken: string) {
      if (!refreshToken) {
        this.logger.warn("[Auth] No refresh token provided for logout.");
        return { success: true };
      }
  
      const logoutUrl = \`\${this.getKeycloakInternalIssuer()}/protocol/openid-connect/logout\`;
      const params = new URLSearchParams();
      params.append("client_id", process.env.KEYCLOAK_CLIENT_ID || "enfycon-ats");
      const clientSecret = process.env.KEYCLOAK_CLIENT_SECRET;
      if (clientSecret) params.append("client_secret", clientSecret);
      params.append("refresh_token", refreshToken);
  
      try {
        let res = await fetch(logoutUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }).catch(() => null);
        if (!res || !res.ok) {
          const altUrl = logoutUrl.includes("localhost")
            ? logoutUrl.replace("localhost", "keycloak")
            : logoutUrl.replace("keycloak", "localhost");
          res = await fetch(altUrl, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }).catch(() => null);
        }
  
        if (res && res.ok) {
          this.logger.log("[Auth] Successfully logged out from Keycloak.");
          return { success: true };
        }
  
        this.logger.warn(\`[Auth] Keycloak logout returned non-OK status: \${res?.status}\`);
      } catch (err: any) {
        this.logger.error(\`[Auth] Failed to logout from Keycloak: \${err.message}\`);
      }
      return { success: true };
    }`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacement);
  fs.writeFileSync(path, content);
  console.log("Patched auth-core.service.ts");
} else {
  console.log("Target string not found!");
}
@
