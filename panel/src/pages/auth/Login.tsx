import { useEffect, useRef, useState } from 'react';
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, LogInIcon } from "lucide-react";
import { ApiVerifyPasswordReq, ApiVerifyPasswordResp, ApiOauthRedirectResp } from '@shared/authApiTypes';
import { useAuth } from '@/hooks/auth';
import { useLocation } from "wouter";
import { fetchWithTimeout } from '@/hooks/fetch';
import { processFetchError } from './errors';
import { ServerGlowIcon } from '@/components/serverIcon';
import { LocalStorageKey } from '@/lib/localStorage';


function HeaderNoServer() {
    return (
        <div className="text-center">
            <div className="text-xl xs:text-2xl text-primary/85 font-semibold line-clamp-1">
                {/* Server Unconfigured */}
                {/* Unconfigured Server */}
                {/* Server Not Configured */}
                {/* Server Not Yet Configured */}
                Welcome to txAdmin!
            </div>
            <div className="text-sm xs:text-base font-normal tracking-wide text-muted-foreground">
                {/* please login to set it up */}
                {/* login to configure it */}
                please login to continue
            </div>
        </div>
    )
}

function HeaderServerInfo() {
    const server = window.txConsts.server;
    if (!server || !server.name || (!server.game && !server.icon)) {
        return <HeaderNoServer />;
    }
    return (<>
        <ServerGlowIcon
            iconFilename={server.icon}
            serverName={server.name}
            gameName={server.game}
        />
        <div className="grow xs:h-full flex flex-col xs:justify-between">
            <div className="text-xl xs:text-2xl font-semibold line-clamp-1">
                {server.name}
            </div>
            <div className="text-sm xs:text-base text-muted-foreground">
                Login to continue
            </div>
        </div>
    </>)
}


export enum LogoutReasonHash {
    NONE = '',
    LOGOUT = '#logout',
    EXPIRED = '#expired',
    UPDATED = '#updated',
    MASTER_ALREADY_SET = '#master_already_set',
    SHUTDOWN = '#shutdown',
}

export default function Login() {
    const { setAuthData } = useAuth();
    const usernameRef = useRef<HTMLInputElement>(null);
    const passwordRef = useRef<HTMLInputElement>(null);
    const [errorMessage, setErrorMessage] = useState<string | undefined>();
    const [isFetching, setIsFetching] = useState(false);
    const setLocation = useLocation()[1];

    const onError = (error: any) => {
        const { errorTitle, errorMessage } = processFetchError(error);
        setErrorMessage(`${errorTitle}:\n${errorMessage}`);
    }

    const onErrorResponse = (error: string) => {
        if (error === 'no_admins_setup') {
            setErrorMessage('No admins set up.\nRedirecting...');
            setLocation('/addMaster/pin');
        } else {
            setErrorMessage(error);
        }
    }

    const handleLogin = async () => {
        try {
            setIsFetching(true);
            const data = await fetchWithTimeout<ApiVerifyPasswordResp, ApiVerifyPasswordReq>(
                `/auth/password?uiVersion=${encodeURIComponent(window.txConsts.txaVersion)}`,
                {
                    method: 'POST',
                    body: {
                        username: usernameRef.current?.value ?? '',
                        password: passwordRef.current?.value ?? '',
                    },
                }
            );
            if ('error' in data) {
                if (data.error === 'refreshToUpdate') {
                    window.location.href = `/login${LogoutReasonHash.UPDATED}`;
                    window.location.reload();
                } else {
                    onErrorResponse(data.error);
                }
            } else {
                setAuthData(data);
            }
        } catch (error) {
            onError(error);
        } finally {
            setIsFetching(false);
        }
    }

    const handleSteamLogin = async () => {
        try {
            setIsFetching(true);
            const data = await fetchWithTimeout<ApiOauthRedirectResp>(
                `/auth/cfxre/redirect?origin=${encodeURIComponent(window.location.origin)}`,
                { method: 'GET' }
            );
            if ('error' in data) {
                onErrorResponse(data.error);
            } else {
                window.location.href = data.authUrl;
            }
        } catch (error) {
            onError(error);
        } finally {
            setIsFetching(false);
        }
    }

    //Prefill username/password if dev pass enabled
    useEffect(() => {
        try {
            const rawLocalStorageStr = localStorage.getItem(LocalStorageKey.AuthCredsAutofill);
            if (rawLocalStorageStr) {
                const [user, pass] = JSON.parse(rawLocalStorageStr);
                usernameRef.current!.value = user ?? '';
                passwordRef.current!.value = pass ?? '';
            }
        } catch (error) {
            console.error('Username/Pass autofill failed', error);
        }
    }, []);

    //Gets the message from the hash and clears it
    useEffect(() => {
        const hash = window.location.hash;
        if (!hash) return;
        if (hash === LogoutReasonHash.LOGOUT) {
            setErrorMessage('Logged Out.');
        } else if (hash === LogoutReasonHash.EXPIRED) {
            setErrorMessage('Session Expired.');
        } else if (hash === LogoutReasonHash.UPDATED) {
            setErrorMessage('txAdmin updated!\nPlease login again.');
        } else if (hash === LogoutReasonHash.MASTER_ALREADY_SET) {
            setErrorMessage('Master account already configured.');
        } else if (hash === LogoutReasonHash.SHUTDOWN) {
            setErrorMessage('The txAdmin server shut down.\nPlease start it again to be able to login.');
        }
        window.location.hash = '';
    }, []);

    return (
        <form
            onSubmit={(e) => { e.preventDefault(); handleLogin();}}
            className='w-full rounded-[inherit]'
        >
            <CardHeader className="rounded-t-[inherit]">
                <CardTitle className="h-14 xs:h-16 flex flex-row justify-center items-center gap-4">
                    <HeaderServerInfo />
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col pt-4 gap-4 border-t rounded-b-[inherit] bg-card">
                {/* Error message */}
                {errorMessage && <div className="text-center text-sm whitespace-pre-wrap text-destructive-inline">
                    {errorMessage}
                </div>}

                {/* Form */}
                <div className="flex flex-col xs:grid grid-cols-8 gap-2 xs:gap-4 items-baseline">
                    <Label className="col-span-2" htmlFor="frm-login">
                        Username
                    </Label>
                    <Input
                        id="frm-login"
                        ref={usernameRef}
                        type="text"
                        placeholder="username"
                        autoCapitalize='off'
                        autoComplete='off'
                        className="col-span-6"
                        required
                    />
                </div>
                <div className="flex flex-col xs:grid grid-cols-8 gap-2 xs:gap-4 items-baseline">
                    <Label className="col-span-2" htmlFor="frm-password">
                        Password
                    </Label>
                    <Input
                        id="frm-password"
                        ref={passwordRef}
                        type="password"
                        placeholder='password'
                        autoCapitalize='off'
                        autoComplete='off'
                        className="col-span-6"
                        required
                    />
                </div>

                {/* Buttons */}
                <Button variant='outline' disabled={isFetching}>
                    {isFetching ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                        <LogInIcon className="inline mr-2 h-4 w-4" />
                    )} Login
                </Button>

                {/* Divider */}
                <div className="relative flex items-center">
                    <div className="grow border-t"></div>
                    <span className="shrink mx-3 text-xs text-muted-foreground">OR</span>
                    <div className="grow border-t"></div>
                </div>

                {/* Steam login */}
                <Button
                    type="button"
                    variant='secondary'
                    disabled={isFetching}
                    onClick={handleSteamLogin}
                    className="bg-[#171a21] hover:bg-[#2a2f3a] text-white"
                >
                    {isFetching
                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        : <SteamIcon className="inline mr-2 h-4 w-4" />
                    } Sign in with Steam
                </Button>
            </CardContent>
        </form>
    );
}

function SteamIcon({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11.98 0C5.66 0 .48 4.88.02 11.1l6.44 2.66a3.4 3.4 0 0 1 1.92-.6l2.87-4.15v-.06a4.53 4.53 0 1 1 4.53 4.53h-.1l-4.09 2.92a3.42 3.42 0 0 1-6.8.5L.28 14.6A12 12 0 1 0 11.98 0zM7.54 18.21l-1.47-.61a2.57 2.57 0 0 0 4.7-.4 2.56 2.56 0 0 0-2.4-3.48c-.34 0-.67.06-.98.19l1.52.63a1.89 1.89 0 1 1-1.45 3.48zm10.5-8.63a3.02 3.02 0 1 0-6.04 0 3.02 3.02 0 0 0 6.04 0zm-5.28 0a2.27 2.27 0 1 1 4.53 0 2.27 2.27 0 0 1-4.53 0z"/>
        </svg>
    );
}
