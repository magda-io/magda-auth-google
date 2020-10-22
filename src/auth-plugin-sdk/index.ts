import { Router, Request, Response } from "express";
import session from "express-session";
import urijs from "urijs";
import createPool, { PoolCreationOptions } from "./createPool";
import AuthApiClient, { User, UserToken, Maybe } from "@magda/auth-api-client";
import passport from "passport";

export type MagdaSessionRouterOptions = {
    sessionSecret: string;
    sessionDBHost: string;
    sessionDBPort: number;
    sessionDBUser?: string; // if not specified, env var will be used
    sessionDBPassword?: string; // if not specified, env var will be used
    // if not specified, will used default `session`
    sessionDBName?: string;
};

export const DEFAULT_SESSION_COOKIE_NAME: string = "connect.sid";

export function createMagdaSessionRouter(
    options: MagdaSessionRouterOptions
): Router {
    const router: Router = Router();
    const { sessionDBUser, sessionDBPassword, sessionDBName } = options;

    const dbConfig = {
        dbHost: options.sessionDBHost,
        dbPort: options.sessionDBPort
    } as PoolCreationOptions;

    if (sessionDBUser) {
        dbConfig.dbUser = sessionDBUser;
    }

    if (sessionDBPassword) {
        dbConfig.dbPassword = sessionDBPassword;
    }

    if (sessionDBName) {
        dbConfig.database = sessionDBName;
    }

    const dbPool = createPool(dbConfig);

    router.use(require("cookie-parser")());

    const store = new (require("connect-pg-simple")(session))({
        pool: dbPool
    });

    const sessionMiddleware = session({
        store,
        // --- we don't have to set session cookie name
        // --- but good to make sure it'd be only one value in our app
        name: DEFAULT_SESSION_COOKIE_NAME,
        // --- no need to set cookie settings. Gateway will auto change the setting according to configuration.
        secret: options.sessionSecret,
        resave: false,
        saveUninitialized: false,
        rolling: true
    });

    router.use(sessionMiddleware);

    return router;
}

/**
 * Different type of AuthenticationMethod:
 * - IDP-URI-REDIRECTION: the plugin will rediredct user agent to idp (identity provider) for authentication. e.g. Google & fackebook oauth etc.
 *   - This is the default method.
 * - PASSWORD: the plugin expect frontend do a form post that contains username & password to the plugin for authentication
 * - QR-CODE: the plugin offers a url that is used by the frontend to request auth challenge data. The data will be encoded into a QR-code image and expect the user scan the QR code with a mobile app to complete the authentication request.
 *   - Once the QR-code image is generated, the frontend is expected to start polling a pre-defined plugin url to check whether the authentication is complete or not.
 */
export type AuthenticationMethod =
    | "IDP-URI-REDIRECTION"
    | "PASSWORD"
    | "QR-CODE";

export interface AuthPluginConfig
    extends Omit<AuthPluginBasicConfig, "baseUrl"> {
    // plugin display name
    name: string;
    iconUrl: string;
    authenticationMethod: AuthenticationMethod;
    loginFormExtraInfoHeading?: string;
    loginFormExtraInfoContent?: string;
    loginFormUsernameFieldLabel?: string;
    loginFormPasswordFieldLabel?: string;
    qrCodeImgDataRequestUrl?: string; // Compulsory when authenticationMethod = "QR-CODE"
    qrCodeAuthResultPollUrl?: string; // Compulsory when authenticationMethod = "QR-CODE"
    qrCodeExtraInfoHeading?: string;
    qrCodeExtraInfoContent?: string;
}

/**
 * Basic Auth Plugin are the config info that supplied to Gateway
 * via [authPlugins](https://github.com/magda-io/magda/tree/master/deploy/helm/internal-charts/gateway) helm chart config
 */
export type AuthPluginBasicConfig = {
    // plugin key. allowed chars [a-zA-Z\-]
    key: string;
    // plugin serving base url. Getway will forward all request to it
    baseUrl: string;
};

export function getAbsoluteUrl(
    url: string,
    baseUrl: string,
    optionalQueries?: { [key: string]: string }
) {
    const uri = urijs(url);
    if (uri.hostname()) {
        // --- absolute url, return directly
        return url;
    } else {
        const baseUri = urijs(baseUrl);
        const query = uri.search(true);
        const mergedUri = baseUri.segmentCoded(
            baseUri.segmentCoded().concat(uri.segmentCoded())
        );

        return mergedUri
            .search({
                ...(optionalQueries ? optionalQueries : {}),
                ...(query ? query : {})
            })
            .toString();
    }
}

export function redirectOnSuccess(toURL: string, req: Request, res: Response) {
    const source = urijs(toURL)
        .setSearch("result", "success")
        .removeSearch("errorMessage");
    res.redirect(source.toString());
}

export function redirectOnError(
    err: any,
    toURL: string,
    req: Request,
    res: Response
) {
    const source = urijs(toURL)
        .setSearch("result", "failure")
        .setSearch("errorMessage", err);
    res.redirect(source.toString());
}

export function createOrGetUserToken(
    authApi: AuthApiClient,
    profile: passport.Profile,
    source: string
): Promise<UserToken> {
    return authApi.lookupUser(source, profile.id).then((maybe: Maybe<User>) =>
        maybe.caseOf({
            just: (user: User) => Promise.resolve(userToUserToken(user)),
            nothing: () =>
                authApi
                    .createUser(profileToUser(profile, source))
                    .then(userToUserToken)
        })
    );
}

function profileToUser(profile: passport.Profile, source: string): User {
    if (!profile.emails || profile.emails.length === 0) {
        throw new Error("User with no email address");
    }

    return {
        displayName: profile.displayName,
        email: profile.emails[0].value,
        photoURL:
            profile.photos && profile.photos.length > 0
                ? profile.photos[0].value
                : undefined,
        source: source,
        sourceId: profile.id,
        isAdmin: false
    };
}

function userToUserToken(user: User): UserToken {
    return {
        id: <string>user.id
    };
}
