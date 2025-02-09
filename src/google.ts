import express, { Router } from "express";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Authenticator, Profile } from "passport";
import ApiClient from "@magda/auth-api-client";
import urijs from "urijs";
import {
    createOrGetUserToken,
    getAbsoluteUrl,
    redirectOnSuccess,
    redirectOnError
} from "@magda/authentication-plugin-sdk";

export interface GoogleOptions {
    authorizationApi: ApiClient;
    passport: Authenticator;
    clientId: string;
    clientSecret: string;
    externalUrl: string;
    allowedExternalRedirectDomains: string[];
    authPluginRedirectUrl: string;
}

function normalizeRedirectionUrl(
    url: string,
    allowedExternalRedirectDomains?: string[]
) {
    if (!url) {
        return "/";
    }
    const allowedDomains = allowedExternalRedirectDomains?.length
        ? allowedExternalRedirectDomains
        : [];
    const redirectUri = urijs(url);
    const host = redirectUri.host();
    if (!host || allowedDomains.indexOf(host) === -1) {
        return redirectUri.resource();
    } else {
        return redirectUri.toString();
    }
}

export default function google(options: GoogleOptions): Router {
    const authorizationApi = options.authorizationApi;
    const passport = options.passport;
    const clientId = options.clientId;
    const clientSecret = options.clientSecret;
    const externalUrl = options.externalUrl;
    const loginBaseUrl = `${externalUrl}/auth/login/plugin`;
    const resultRedirectionUrl = getAbsoluteUrl(
        options.authPluginRedirectUrl,
        externalUrl
    );
    const allowedExternalRedirectDomains =
        options.allowedExternalRedirectDomains;

    if (!clientId) {
        throw new Error("Google client id can't be empty!");
    }

    if (!clientSecret) {
        throw new Error("Google client secret can't be empty!");
    }

    passport.use(
        new GoogleStrategy(
            {
                clientID: clientId,
                clientSecret: clientSecret,
                callbackURL: `${loginBaseUrl}/google/return`
            },
            function (
                accessToken: string,
                refreshToken: string,
                profile: Profile,
                cb: (error: any, user?: any, info?: any) => void
            ) {
                createOrGetUserToken(authorizationApi, profile, "google")
                    .then((userToken) => cb(null, userToken))
                    .catch((error) => cb(error));
            }
        )
    );

    const router: express.Router = express.Router();

    router.get("/", (req, res, next) => {
        const options: any = {
            scope: ["profile", "email"],
            state:
                typeof req?.query?.redirect === "string" && req.query.redirect
                    ? getAbsoluteUrl(req.query.redirect, externalUrl)
                    : resultRedirectionUrl
        };
        passport.authenticate("google", options)(req, res, next);
    });

    router.get(
        "/return",
        (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) => {
            passport.authenticate("google", {
                failWithError: true
            })(req, res, next);
        },
        (
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ) => {
            redirectOnSuccess(
                normalizeRedirectionUrl(
                    req.query.state as string,
                    allowedExternalRedirectDomains
                ),
                req,
                res
            );
        },
        (
            err: any,
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ): any => {
            redirectOnError(
                err,
                normalizeRedirectionUrl(
                    req.query.state as string,
                    allowedExternalRedirectDomains
                ),
                req,
                res
            );
        }
    );

    return router;
}
