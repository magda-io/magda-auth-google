# 3.0.0

- Upgrade express to v4.21.2
- Upgrade @magda/ci-utils to v1.0.5
- Upgrade @magda/docker-utils to v5.0.0
- Upgrade @magda/auth-api-client to v5.0.0
- Upgrade @magda/authentication-plugin-sdk to v5.0.0
- Upgrade passport to 0.7.0
- Upgrade yargs to 17.7.2 
- Build as ESM module
- Upgrade to Node 18
- Code adjustment for yargs upgrade
- fixes: Use __dirname from @magda/esm-utils

# 2.0.1

-   add support to allowedExternalRedirectDomains config options
-   deployment auto roll based on config
-   not set deployment replicas when autoscaler is on

# 2.0.0

-   Upgrade nodejs to version 14
-   Upgrade other dependencies
-   Release all artifacts to GitHub Container Registry (instead of docker.io & https://charts.magda.io)
-   Upgrade magda-common chart version to v2.1.1
-   Build multi-arch docker images

# v1.2.3

- Upgrade to magda-common lib chart v1.0.0-alpha.4
- Use named templates from magda-common lib chart for docker image related logic

# v1.2.2

- Will not check & use global image config anymore. Only magda core repo modules / charts will check & use global image config. 

# v1.2.1

- Use library chart "magda-common" & fix Magda v1 deployment issue on the first deployment

# v1.2.0

- Change the way of locate session-db secret to be compatible with Magda v1 (still backwards compatible with earlier versions)