# magda-auth-google

![Version: 1.2.1](https://img.shields.io/badge/Version-1.2.1-informational?style=flat-square)

A Magda Authentication Plugin for Google

Requires MAGDA version 0.0.58 or above.

To deploy the authentication plugin with your MAGDA instance, please check [MAGDA Gateway Helm Chart Document](https://github.com/magda-io/magda/blob/master/deploy/helm/internal-charts/gateway/README.md).

### How to Use
1. Add the auth plugin as a [Helm Chart Dependency](https://helm.sh/docs/helm/helm_dependency/)
```yaml
- name: magda-auth-google
  version: 1.1.0
  repository: https://charts.magda.io
```

2. Config the auth plugin with googleClientId:
```yaml
magda-auth-google:
  googleClientId: xxxxxx
```

3. Config Gatway to add the auth plugin to Gateway's plugin list (More details see [here](https://github.com/magda-io/magda/blob/master/deploy/helm/internal-charts/gateway/README.md))
```yaml
gateway:
  authPlugins:
  - key: "google"
    baseUrl: http://magda-auth-google
```

4. Create a secret `oauth-secrets` in your deployment Magda namespace with the correct value for `google-client-secret` key

#### Google API Setup

1. Open Google Cloud Console

2. Go to `Credentials (APIs and Services)`

3. Create an OAuth 2.0 Client IDs

The `Authorised redirect URIs` should be: https://my-magda.com/auth/login/plugin/google/return

Here `my-magda.com` is the domain you serve magda from. It should match [helm chart config `global.externalUrl`](https://github.com/magda-io/magda/tree/master/deploy/helm/magda-core).

**Homepage:** <https://github.com/magda-io/magda-auth-google>

## Source Code

* <https://github.com/magda-io/magda-auth-google>

## Requirements

Kubernetes: `>= 1.14.0-0`

| Repository | Name | Version |
|------------|------|---------|
| https://charts.magda.io | magda-common | 1.0.0-alpha.0 |

## Values

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| authPluginRedirectUrl | string | `nil` | the redirection url after the whole authentication process is completed. Authentication Plugins will use this value as default. The following query paramaters can be used to supply the authentication result: <ul> <li>result: (string) Compulsory. Possible value: "success" or "failure". </li> <li>errorMessage: (string) Optional. Text message to provide more information on the error to the user. </li> </ul> This field is for overriding the value set by `global.authPluginRedirectUrl`. Unless you want to have a different value only for this auth plugin, you shouldn't set this value. |
| autoscaler.enabled | bool | `false` | turn on the autoscaler or not |
| autoscaler.maxReplicas | int | `3` |  |
| autoscaler.minReplicas | int | `1` |  |
| autoscaler.targetCPUUtilizationPercentage | int | `80` |  |
| defaultAdminUserId | string | `"00000000-0000-4000-8000-000000000000"` | which system account we used to talk to auth api The value of this field will only be used when `global.defaultAdminUserId` has no value |
| defaultImage.imagePullSecret | bool | `false` |  |
| defaultImage.pullPolicy | string | `"IfNotPresent"` |  |
| defaultImage.repository | string | `"docker.io/data61"` |  |
| global | object | `{"authPluginRedirectUrl":"/sign-in-redirect","externalUrl":"","image":{},"rollingUpdate":{}}` | only for providing appropriate default value for helm lint |
| googleClientId | string | `nil` | Google Client Id. You **must** provide this value to make this plugin work Besides, this id. You also need to provide `googleClientSecret` via secret `oauth-secrets` (key: google-client-secret). You can use [Magda Create Secret Tool](https://www.npmjs.com/package/@magda/create-secrets) to create this secret. |
| image.name | string | `"magda-auth-google"` | default docker image name |
| replicas | int | `1` | no. of initial replicas |
| resources.limits.cpu | string | `"50m"` |  |
| resources.requests.cpu | string | `"10m"` |  |
| resources.requests.memory | string | `"30Mi"` |  |
