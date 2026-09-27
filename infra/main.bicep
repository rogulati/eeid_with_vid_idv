targetScope = 'resourceGroup'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@minLength(2)
@maxLength(60)
@description('Globally unique App Service web app name.')
param appName string

@allowed([
  'F1'
  'B1'
])
@description('App Service plan SKU. B1 is recommended to avoid cold starts.')
param appServicePlanSku string = 'B1'

@description('Microsoft Entra External ID tenant ID.')
param entraTenantId string

@description('Microsoft Entra External ID tenant subdomain, without .onmicrosoft.com.')
param entraTenantSubdomain string

@description('Microsoft Entra External ID application client ID.')
param entraClientId string

@secure()
@description('Microsoft Entra External ID application client secret.')
param entraClientSecret string

@description('Verified ID authority DID used to create presentation and issuance requests.')
param verifiedIdAuthority string

@description('Verified ID credential manifest URL for the loyalty credential.')
param verifiedIdManifest string

@description('Verified ID loyalty credential type.')
param verifiedIdType string = 'NorthstarLoyalty'

@description('Microsoft Graph property name for the External ID isVerified custom attribute.')
param graphIsVerifiedAttribute string

@description('Microsoft Graph property name for the External ID loyalty custom attribute.')
param graphLoyaltyAttribute string

@description('Microsoft Graph property name for the External ID Verified ID expiration custom attribute.')
param graphVerifiedIdExpirationAttribute string

@description('Optional CIAM Store signup event endpoint.')
param ciamStoreEventUrl string = ''

@description('Optional CIAM Store connection identifier for this travel application.')
param ciamStoreConnectionId string = ''

@secure()
@description('Optional shared secret used to sign CIAM Store signup events.')
param ciamStoreEventSecret string = ''

@secure()
@minLength(32)
@description('Random value used by Express to sign session cookies.')
param sessionSecret string

@secure()
@minLength(32)
@description('Random API key used to authenticate Verified ID callback events.')
param verifiedIdCallbackApiKey string

@description('Public Git repository from which App Service deploys the application.')
param repoUrl string = 'https://github.com/rogulati/eeid_with_vid_idv.git'

@description('Git branch to deploy.')
param branch string = 'main'

module webApp 'webapp.bicep' = {
  name: 'northstar-webapp'
  params: {
    appName: appName
    appServicePlanSku: appServicePlanSku
    branch: branch
    ciamStoreConnectionId: ciamStoreConnectionId
    ciamStoreEventSecret: ciamStoreEventSecret
    ciamStoreEventUrl: ciamStoreEventUrl
    entraClientId: entraClientId
    entraClientSecret: entraClientSecret
    entraTenantId: entraTenantId
    entraTenantSubdomain: entraTenantSubdomain
    graphIsVerifiedAttribute: graphIsVerifiedAttribute
    graphLoyaltyAttribute: graphLoyaltyAttribute
    graphVerifiedIdExpirationAttribute: graphVerifiedIdExpirationAttribute
    location: location
    repoUrl: repoUrl
    sessionSecret: sessionSecret
    verifiedIdAuthority: verifiedIdAuthority
    verifiedIdCallbackApiKey: verifiedIdCallbackApiKey
    verifiedIdManifest: verifiedIdManifest
    verifiedIdType: verifiedIdType
  }
}

output appName string = appName
output appUrl string = webApp.outputs.appUrl
output redirectUri string = webApp.outputs.redirectUri
