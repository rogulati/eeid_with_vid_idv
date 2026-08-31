@description('Azure region for all resources.')
param location string

@description('Globally unique App Service web app name.')
param appName string

@description('App Service plan SKU.')
param appServicePlanSku string

@description('Microsoft Entra External ID tenant ID.')
param entraTenantId string

@description('Microsoft Entra External ID tenant subdomain.')
param entraTenantSubdomain string

@description('Microsoft Entra External ID application client ID.')
param entraClientId string

@description('Verified ID authority DID.')
param verifiedIdAuthority string

@description('Verified ID credential manifest URL.')
param verifiedIdManifest string

@description('Verified ID loyalty credential type.')
param verifiedIdType string

@description('Microsoft Graph property name for the External ID isVerified custom attribute.')
param graphIsVerifiedAttribute string

@description('Microsoft Graph property name for the External ID loyalty custom attribute.')
param graphLoyaltyAttribute string

@description('Microsoft Graph property name for the External ID Verified ID expiration custom attribute.')
param graphVerifiedIdExpirationAttribute string

@secure()
@description('Microsoft Entra External ID application client secret.')
param entraClientSecret string

@secure()
@description('Random value used by Express to sign session cookies.')
param sessionSecret string

@secure()
@description('Random API key used to authenticate Verified ID callback events.')
param verifiedIdCallbackApiKey string

@description('Public Git repository from which App Service deploys the application.')
param repoUrl string

@description('Git branch to deploy.')
param branch string

var planName = '${appName}-plan'
var appHost = '${appName}.azurewebsites.net'

resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: appServicePlanSku
  }
  properties: {
    reserved: true
  }
}

resource app 'Microsoft.Web/sites@2024-11-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    clientAffinityEnabled: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      alwaysOn: appServicePlanSku != 'F1'
      appCommandLine: 'npm start'
      ftpsState: 'Disabled'
      healthCheckPath: '/health'
      http20Enabled: true
      linuxFxVersion: 'NODE|22-lts'
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'NODE_ENV'
          value: 'production'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
        {
          name: 'ENTRA_TENANT_ID'
          value: entraTenantId
        }
        {
          name: 'ENTRA_TENANT_SUBDOMAIN'
          value: entraTenantSubdomain
        }
        {
          name: 'ENTRA_CLIENT_ID'
          value: entraClientId
        }
        {
          name: 'ENTRA_CLIENT_SECRET'
          value: entraClientSecret
        }
        {
          name: 'ENTRA_REDIRECT_URI'
          value: 'https://${appHost}/auth/redirect'
        }
        {
          name: 'GRAPH_IS_VERIFIED_ATTRIBUTE'
          value: graphIsVerifiedAttribute
        }
        {
          name: 'GRAPH_LOYALTY_ATTRIBUTE'
          value: graphLoyaltyAttribute
        }
        {
          name: 'GRAPH_VERIFIED_ID_EXPIRATION_ATTRIBUTE'
          value: graphVerifiedIdExpirationAttribute
        }
        {
          name: 'SESSION_SECRET'
          value: sessionSecret
        }
        {
          name: 'VERIFIED_ID_AUTHORITY'
          value: verifiedIdAuthority
        }
        {
          name: 'VERIFIED_ID_CALLBACK_API_KEY'
          value: verifiedIdCallbackApiKey
        }
        {
          name: 'VERIFIED_ID_MANIFEST'
          value: verifiedIdManifest
        }
        {
          name: 'VERIFIED_ID_TYPE'
          value: verifiedIdType
        }
      ]
    }
  }
}

resource logs 'Microsoft.Web/sites/config@2024-11-01' = {
  parent: app
  name: 'logs'
  properties: {
    applicationLogs: {
      fileSystem: {
        level: 'Information'
      }
    }
    httpLogs: {
      fileSystem: {
        enabled: true
        retentionInDays: 3
        retentionInMb: 25
      }
    }
    failedRequestsTracing: {
      enabled: true
    }
    detailedErrorMessages: {
      enabled: true
    }
  }
}

resource sourceControl 'Microsoft.Web/sites/sourcecontrols@2022-09-01' = {
  parent: app
  name: 'web'
  properties: {
    repoUrl: repoUrl
    branch: branch
    isManualIntegration: true
  }
}

output appUrl string = 'https://${appHost}'
output redirectUri string = 'https://${appHost}/auth/redirect'