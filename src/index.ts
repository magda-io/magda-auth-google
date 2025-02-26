import express from "express";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import google from "./google.js";
import AuthApiClient, { UserToken } from "@magda/auth-api-client";
import {
    createMagdaSessionRouter,
    AuthPluginConfig
} from "@magda/authentication-plugin-sdk";
import { __dirname } from "@magda/esm-utils";

const coerceJson = (path?: string) => path && require(path);

const argv = yargs(hideBin(process.argv))
    .config()
    .help()
    .option("listenPort", {
        describe: "The TCP/IP port on which the gateway should listen.",
        type: "number",
        default: 6201
    })
    .option("authPluginRedirectUrl", {
        describe:
            "The URL that auth plugin shoulud redirect and report authentication report to.",
        type: "string",
        default: "/sign-in-redirect"
    })
    .option("externalUrl", {
        describe: "The base external URL of the gateway.",
        type: "string",
        default: "http://localhost:6100"
    })
    .option("authPluginConfigJson", {
        describe:
            "Auth Plugin Config" +
            "See https://github.com/magda-io/magda/blob/master/docs/docs/authentication-plugin-spec.md.",
        type: "string",
        coerce: coerceJson
    })
    .option("allowedExternalRedirectDomainsConfigJson", {
        describe:
            "allowedExternalRedirectDomains" +
            "See https://github.com/magda-io/magda/blob/master/docs/docs/authentication-plugin-spec.md.",
        type: "string",
        coerce: coerceJson
    })
    .option("dbHost", {
        describe: "The host running the session database.",
        type: "string",
        default: "localhost"
    })
    .option("dbPort", {
        describe: "The port running the session database.",
        type: "number",
        default: 5432
    })
    .option("authApiUrl", {
        describe: "The base URL of the authorization API.",
        type: "string",
        default: "http://localhost:6104/v0"
    })
    .option("jwtSecret", {
        describe:
            "The secret to use to sign JSON Web Token (JWT) for authenticated requests.  This can also be specified with the JWT_SECRET environment variable.",
        type: "string",
        default:
            process.env.JWT_SECRET || process.env.npm_package_config_jwtSecret
    })
    .option("sessionSecret", {
        describe:
            "The secret to use to sign session cookies.  This can also be specified with the SESSION_SECRET environment variable.",
        type: "string",
        default:
            process.env.SESSION_SECRET ||
            process.env.npm_package_config_SESSION_SECRET
    })
    .option("cookieJson", {
        describe:
            "Path of the json that defines cookie options, as per " +
            "https://github.com/expressjs/session#cookie. These will " +
            "be merged with the default options specified in Authenticator.ts.",
        type: "string",
        coerce: coerceJson
    })
    .option("googleClientId", {
        describe: "The client ID to use for Google OAuth.",
        type: "string",
        default:
            process.env.GOOGLE_CLIENT_ID ||
            process.env.npm_package_config_googleClientId
    })
    .option("googleClientSecret", {
        describe:
            "The secret to use for Google OAuth.  This can also be specified with the GOOGLE_CLIENT_SECRET environment variable.",
        type: "string",
        default:
            process.env.GOOGLE_CLIENT_SECRET ||
            process.env.npm_package_config_googleClientSecret
    })
    .option("userId", {
        describe:
            "The user id to use when making authenticated requests to the registry",
        type: "string",
        default: process.env.USER_ID || process.env.npm_package_config_userId
    })
    .parseSync();

const authPluginConfig = argv.authPluginConfigJson as any as AuthPluginConfig;
const allowedExternalRedirectDomains = argv
    ?.allowedExternalRedirectDomainsConfigJson?.length
    ? (argv.allowedExternalRedirectDomainsConfigJson as any as string[])
    : ([] as string[]);

// Create a new Express application.
const app = express();

/**
 * K8s liveness probe
 */
app.get("/healthz", (req, res) => res.send("OK"));

/**
 * a 36x36 size icon to be shown on frontend login page
 */
app.get("/icon.svg", (req, res) =>
    res.sendFile(path.resolve(__dirname(), "../assets/google-logo.svg"))
);

/**
 * response plugin config so other module knows how to interact with this plugin
 * See [authentication-plugin-spec.md](https://github.com/magda-io/magda/blob/master/docs/docs/authentication-plugin-spec.md)
 */
app.get("/config", (req, res) => res.json(authPluginConfig));

/**
 * Connect to magda session db & enable express session
 * It doesn't initialise passport or passport session so you can customise session data at passport level if you choose to
 */
app.use(
    createMagdaSessionRouter({
        cookieOptions: argv.cookieJson as any,
        sessionSecret: argv.sessionSecret,
        sessionDBHost: argv.dbHost,
        sessionDBPort: argv.dbPort
    })
);

// Setup & initialise passport
const passport = require("passport");

/**
 * Setup user data serialisation & deserialisation handlers for passport session
 * Here simply retrieve & store the same user data with no changes
 * These handlers logic should NOT be changed.
 * If it's require to save extra data in session, please implement relevant logic in your passport Strategy `VerifyCallback`.
 */
passport.serializeUser((user: UserToken, cb: any) => cb(null, user));
passport.deserializeUser((user: UserToken, cb: any) => cb(null, user));

// initialise passport
app.use(passport.initialize());

// initialise passport session
app.use(passport.session());

const authApiClient = new AuthApiClient(
    argv.authApiUrl,
    argv.jwtSecret,
    argv.userId
);

app.use(
    google({
        passport: passport,
        authorizationApi: authApiClient,
        clientId: argv.googleClientId,
        clientSecret: argv.googleClientSecret,
        externalUrl: argv.externalUrl,
        authPluginRedirectUrl: argv.authPluginRedirectUrl,
        allowedExternalRedirectDomains
    })
);

app.listen(argv.listenPort);
console.log("Listening on port " + argv.listenPort);

process.on(
    "unhandledRejection",
    (reason: {} | null | undefined, promise: Promise<any>) => {
        console.error("Unhandled rejection");
        console.error(reason);
    }
);
