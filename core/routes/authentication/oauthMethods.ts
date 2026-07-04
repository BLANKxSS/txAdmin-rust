
const modulename = 'WebServer:OauthMethods';
import { InitializedCtx } from "@modules/WebServer/ctxTypes";
import { ValidSessionType } from "@modules/WebServer/middlewares/sessionMws";
import { ApiOauthCallbackErrorResp, ApiOauthCallbackResp } from "@shared/authApiTypes";
import { randomUUID } from "node:crypto";
import consoleFactory from '@lib/console';
import { UserInfoType } from "@modules/AdminStore/providers/Steam";
const console = consoleFactory(modulename);


/**
 * Sets the user session and generates the Steam OpenID redirect url
 */
export const getOauthRedirectUrl = (ctx: InitializedCtx, purpose: 'login' | 'addMaster', origin: string) => {
    const callbackUrl = origin + `/${purpose}/callback`;

    //Setting up session
    const sessData = {
        tmpOauthLoginStateKern: randomUUID(),
        tmpOauthLoginCallbackUri: callbackUrl,
    } satisfies ValidSessionType;
    ctx.sessTools.set(sessData);

    //Generate the Steam OpenID Auth URL (realm = site origin)
    return txCore.adminStore.providers.steam.getAuthURL(callbackUrl, origin);
}


/**
 * Handles the Steam OpenID callback: verifies the signed response with Steam and returns the userInfo
 */
export const handleOauthCallback = async (ctx: InitializedCtx, redirectUri: string): Promise<ApiOauthCallbackErrorResp | UserInfoType> => {
    //Checking session
    const inboundSession = ctx.sessTools.get();
    if (!inboundSession || !inboundSession?.tmpOauthLoginStateKern || !inboundSession?.tmpOauthLoginCallbackUri) {
        return {
            errorCode: 'invalid_session',
        };
    }

    //Verify the OpenID response with Steam and get the userInfo
    try {
        return await txCore.adminStore.providers.steam.processCallback(
            inboundSession.tmpOauthLoginCallbackUri,
            redirectUri,
        );
    } catch (e) {
        const error = e as any;
        console.warn(`Steam OpenID callback error: ${error.message}`);
        if (error.name === 'TimeoutError' || error.code === 'ETIMEDOUT') {
            return {
                errorCode: 'timeout',
            };
        } else {
            return {
                errorTitle: 'Steam login error:',
                errorMessage: error.message,
            };
        }
    }
}
