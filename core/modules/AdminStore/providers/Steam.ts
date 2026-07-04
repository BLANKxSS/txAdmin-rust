const modulename = 'AdminStore:SteamProvider';
import { URL, URLSearchParams } from 'node:url';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID_REGEX = /^https?:\/\/steamcommunity\.com\/openid\/id\/(7656\d{13})$/;

//NOTE: matches the UserInfoType shape the oauth routes expect (name, profile, nameid, picture)
export type UserInfoType = {
    name: string;
    profile: string;
    nameid: string; //the SteamID64
    picture: string | undefined;
};


/**
 * Steam OpenID 2.0 authentication provider.
 * Unlike Cfx.re (OAuth2/OIDC), Steam uses OpenID 2.0: we redirect the user to Steam,
 * Steam redirects back with signed openid.* params, and we verify them by echoing them
 * back to Steam with mode=check_authentication. Only a `is_valid:true` response is trusted.
 */
export default class SteamProvider {
    constructor() {
        //No async setup needed - Steam OpenID is stateless.
    }


    /**
     * Returns the Steam OpenID login URL.
     * @param returnTo the callback URL Steam will redirect the browser back to
     * @param realm the site origin (must be a prefix of returnTo)
     */
    getAuthURL(returnTo: string, realm: string) {
        const params = new URLSearchParams({
            'openid.ns': 'http://specs.openid.net/auth/2.0',
            'openid.mode': 'checkid_setup',
            'openid.return_to': returnTo,
            'openid.realm': realm,
            'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
            'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
        });
        return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`;
    }


    /**
     * Verifies the OpenID callback with Steam and returns the user info.
     * @param expectedReturnTo the callback URL saved in the session (must match the response)
     * @param callbackUrl the full callback URL the browser was redirected to (with openid.* params)
     */
    async processCallback(expectedReturnTo: string, callbackUrl: string): Promise<UserInfoType> {
        const parsed = new URL(callbackUrl);
        const params = parsed.searchParams;

        //Basic sanity: this must be an id_res response
        if (params.get('openid.mode') !== 'id_res') {
            throw new Error('Steam did not return a valid login response (mode != id_res).');
        }

        //The return_to Steam signed must match the one we issued (prevents replay to other endpoints)
        const returnedReturnTo = params.get('openid.return_to');
        if (!returnedReturnTo || new URL(returnedReturnTo).pathname !== new URL(expectedReturnTo).pathname) {
            throw new Error('OpenID return_to mismatch.');
        }

        //Extract & validate the claimed SteamID64 BEFORE trusting it (verified below)
        const claimedId = params.get('openid.claimed_id') ?? '';
        const match = CLAIMED_ID_REGEX.exec(claimedId);
        if (!match) {
            throw new Error('Could not extract a valid SteamID64 from the OpenID response.');
        }
        const steamId64 = match[1];

        //Verify the signature by echoing all params back to Steam with mode=check_authentication
        const verifyParams = new URLSearchParams();
        for (const [key, value] of params.entries()) {
            verifyParams.set(key, value);
        }
        verifyParams.set('openid.mode', 'check_authentication');

        let verifyBody: string;
        try {
            const resp = await fetch(STEAM_OPENID_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: verifyParams.toString(),
                signal: AbortSignal.timeout(10_000),
            });
            verifyBody = await resp.text();
        } catch (error) {
            throw new Error(`Failed to reach Steam for verification: ${(error as Error).message}`);
        }

        if (!/is_valid\s*:\s*true/i.test(verifyBody)) {
            throw new Error('Steam rejected the OpenID signature (login could not be verified).');
        }

        //Verified. Fetch a display name + avatar from the public profile (no API key needed).
        const { name, picture } = await this.fetchProfile(steamId64);

        return {
            name,
            profile: `https://steamcommunity.com/profiles/${steamId64}`,
            nameid: steamId64,
            picture,
        };
    }


    /**
     * Best-effort fetch of the persona name + avatar from the public profile XML.
     * Falls back to a generic name if the profile is private or unreachable.
     */
    private async fetchProfile(steamId64: string): Promise<{ name: string; picture: string | undefined }> {
        try {
            const resp = await fetch(`https://steamcommunity.com/profiles/${steamId64}?xml=1`, {
                signal: AbortSignal.timeout(8_000),
            });
            const xml = await resp.text();
            const name = xml.match(/<steamID>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/steamID>/)?.[1]?.trim();
            const avatar = xml.match(/<avatarFull>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/avatarFull>/)?.[1]?.trim();
            return {
                name: (name && name.length) ? name : `Steam ${steamId64}`,
                picture: (avatar && avatar.startsWith('https://')) ? avatar : undefined,
            };
        } catch (error) {
            console.verbose.warn(`Could not fetch Steam profile for ${steamId64}: ${(error as Error).message}`);
            return { name: `Steam ${steamId64}`, picture: undefined };
        }
    }
};
