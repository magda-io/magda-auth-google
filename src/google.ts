import express, { Router } from "express";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Authenticator, Profile } from "passport";
import { default as ApiClient } from "@magda/auth-api-client";
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
    authPluginRedirectUrl: string;
    userSessionRules?: string;
}

export default function google(options: GoogleOptions): Router {
    const userSessionRules: any | undefined = options.userSessionRules
        ? JSON.parse(require(options.userSessionRules))
        : undefined;
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

                const emails = profile.emails;
                const roles: Array<string> = userSessionRules?.roles? userSessionRules.roles : [];
                const groups: Array<string> = userSessionRules?.groups? userSessionRules.groups : [];

                createOrGetUserToken(
                    authorizationApi,
                    profile,
                    "google",
                    async (apiClient, user, profile) => {
                        console.log("Before user is created...");
                        console.log("User: ", user);
                        console.log("Profile: ", profile);

                        return {
                            ...user
                        };
                    },
                    async (apiClient, user, profile) => {
                        console.log("After user is created...");
                        console.log("User: ", user);
                        console.log("Profile: ", profile);
                        // If assigning admin role to a user without setting isAdmin flag, the user will not have non-read permissions.
                        // As precausion, better not to set the flag in case of config mistake. Manually set this flag if required.
                        const filteredRoles = roles.filter(r => emails.some((val) => userSessionRules[`${r}`].indexOf(val.type) !== -1));
                        const newRoleIdList = await apiClient.addUserRoles(
                            user.id!,
                            filteredRoles
                        );

                        console.log("Roles: ", newRoleIdList);
                    }
                )
                    .then((userToken) => {
                        const filteredGroups: Array<string> = groups.filter(g => emails.some((val) => userSessionRules[`${g}`].indexOf(val.value) !== -1));
                        cb(null, {
                            ...userToken,
                            session: { groups: filteredGroups }
                        })
                    })
                    .catch((error) => cb(error));
            })
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
            redirectOnSuccess(req.query.state as string, req, res);
        },
        (
            err: any,
            req: express.Request,
            res: express.Response,
            next: express.NextFunction
        ): any => {
            redirectOnError(err, req.query.state as string, req, res);
        }
    );

    return router;
}
