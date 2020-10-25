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
                createOrGetUserToken(
                    authorizationApi,
                    profile,
                    "google",
                    async (apiClient, user, profile) => {
                        console.log("Before user is created...");
                        console.log("User: ", user);
                        console.log("Profile: ", profile);

                        return {
                            ...user,
                            // Set user's organisation unit id
                            // We may do some lookup using profile data to determine which orgUnitId we should auto assign to the user
                            orgUnitId: "6f833dbd-27e8-4ec6-a9bd-20e443030546"
                        };
                    },
                    async (apiClient, user, profile) => {
                        console.log("After user is created...");
                        console.log("User: ", user);
                        console.log("Profile: ", profile);

                        // Add admin role in additional to the default `AUTHENTICATED_USERS_ROLE`
                        // we can decide which role to add to user by looking at profile data
                        const newRoleIdList = await apiClient.addUserRoles(
                            user.id!,
                            ["00000000-0000-0003-0000-000000000000"]
                        );

                        console.log("Roles: ", newRoleIdList);
                    }
                )
                    .then((userToken) =>
                        cb(null, {
                            ...userToken,
                            // save some extra data to session
                            // you can verify the session data from session database
                            myExtraSessionData: { abc: 123 }
                        })
                    )
                    .catch((error) => cb(error));
            }
        )
    );

    const router: express.Router = express.Router();

    router.get("/", (req, res, next) => {
        const options: any = {
            scope: ["profile", "email"],
            state: resultRedirectionUrl
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
