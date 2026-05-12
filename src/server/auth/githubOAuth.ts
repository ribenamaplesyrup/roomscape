export interface GitHubOAuthProfile {
  accountId: string;
  username: string;
  email?: string;
  name?: string;
}

export interface GitHubOAuthProvider {
  authorizationUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<GitHubOAuthProfile>;
}

interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
}

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  id?: number;
  login?: string;
  email?: string | null;
  name?: string | null;
}

interface GitHubEmailResponse {
  email?: string;
  primary?: boolean;
  verified?: boolean;
}

export function createGitHubOAuthProvider(env: NodeJS.ProcessEnv): GitHubOAuthProvider | undefined {
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  return new GitHubOAuthClient({ clientId, clientSecret });
}

export class GitHubOAuthClient implements GitHubOAuthProvider {
  public constructor(private readonly config: GitHubOAuthConfig) {}

  public authorizationUrl(state: string, redirectUri: string): string {
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", "read:user user:email");
    url.searchParams.set("state", state);
    return url.toString();
  }

  public async exchangeCode(code: string, redirectUri: string): Promise<GitHubOAuthProfile> {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const token = (await tokenResponse.json()) as GitHubTokenResponse;
    if (!tokenResponse.ok || token.error || !token.access_token) {
      throw new Error(token.error_description ?? token.error ?? "GitHub OAuth token exchange failed.");
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token.access_token}`,
        "User-Agent": "roomscape",
      },
    });
    const user = (await userResponse.json()) as GitHubUserResponse;
    if (!userResponse.ok || typeof user.id !== "number" || !user.login) {
      throw new Error("GitHub user lookup failed.");
    }

    const email = user.email ?? (await this.primaryEmail(token.access_token));
    return {
      accountId: String(user.id),
      username: user.login,
      ...(email ? { email } : {}),
      ...(user.name ? { name: user.name } : {}),
    };
  }

  private async primaryEmail(accessToken: string): Promise<string | undefined> {
    const response = await fetch("https://api.github.com/user/emails", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "roomscape",
      },
    });
    if (!response.ok) return undefined;
    const emails = (await response.json()) as GitHubEmailResponse[];
    return emails.find((email) => email.primary && email.verified)?.email ?? emails.find((email) => email.verified)?.email;
  }
}
