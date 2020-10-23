import express from "express";
import yargs from "yargs";
import google from "./google";
import AuthApiClient from "@magda/auth-api-client";
import { createMagdaSessionRouter, AuthPluginConfig } from "./auth-plugin-sdk";

const argv = yargs
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
            process.env.JWT_SECRET || process.env.npm_package_config_JWT_SECRET,
        demand: true
    })
    .option("sessionSecret", {
        describe:
            "The secret to use to sign session cookies.  This can also be specified with the SESSION_SECRET environment variable.",
        type: "string",
        default:
            process.env.SESSION_SECRET ||
            process.env.npm_package_config_SESSION_SECRET,
        demand: true
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
        demand: true,
        default: process.env.USER_ID || process.env.npm_package_config_userId
    }).argv;

// Create a new Express application.
const app = express();

/** 
 * K8s liveness probe
*/
app.get("/healthz", (req, res) => res.send("OK"));

/**
 * a 36x36 size icon to be shown on frontend login page
 */
app.get("/icon.svg", (req, res) => res.sendFile("./assets/google-logo.svg"));

/**
 * response plugin config so other module knows how to interact with this plugin
 * See [authentication-plugin-spec.md](https://github.com/magda-io/magda/blob/master/docs/docs/authentication-plugin-spec.md)
 */
app.get("/config", (req, res) =>
    res.json({
        key: "google",
        name: "Google",
        iconUrl: "/icon.svg",
        authenticationMethod: "IDP-URI-REDIRECTION"
    } as AuthPluginConfig)
);

/**
 * Connect to magda session db & enable express session
 * It doesn't initialise passport or passport session so you can customise session data at passport level if you choose to
 */
app.use(
    createMagdaSessionRouter({
        sessionSecret: argv.sessionSecret,
        sessionDBHost: argv.dbHost,
        sessionDBPort: argv.dbPort
    })
);

const passport = require("passport");

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
        authPluginRedirectUrl: argv.authPluginRedirectUrl
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
