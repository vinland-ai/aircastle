import type { CreateClientConfig } from './generated/client.gen'

/** Returns the signed-in user's session token, or null when signed out. */
export type TokenGetter = () => Promise<string | null>

let getToken: TokenGetter = async () => null

/** Set where API calls get their bearer token, such as Clerk's `getToken`. */
export function setTokenGetter(getter: TokenGetter) {
  getToken = getter
}

/** Point the generated client at the API, and send the token to secured operations. */
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: process.env.NEXT_PUBLIC_API_URL,
  auth: async () => (await getToken()) ?? undefined,
})
