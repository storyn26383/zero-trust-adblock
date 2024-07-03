import 'dotenv/config'
import Cloudflare from 'cloudflare'

const AD_SERVERS_LIMIT = 100000
const LIST_ITESM_LIMIT = 1000
const AUTO_CREATED_DESCRIPTION = '# auto created via script #'

function chunk<T>(list: T[], size: number): T[][] {
  const result = []

  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size))
  }

  return result
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runPromisesInSequence(promises: (() => Promise<any>)[]) {
  for (const promise of promises) {
    await promise()
    await sleep(1000)
  }
}

async function fetchAdServers() {
  const response = await fetch('https://raw.githubusercontent.com/storyn26383/adservers/master/adservers.txt')
  const body = await response.text()
  const adservers = body.split('\n')

  console.log(`Fetched ${adservers.length} ad servers`)

  return adservers
}

async function fetchAdServerLists(client: Cloudflare) {
  const { result } = await client.zeroTrust.gateway.lists.list({
    account_id: process.env.CLOUDFLARE_ACCOUNT_ID!
  })

  const list = result.filter(({ id, description }) => id && description === AUTO_CREATED_DESCRIPTION)

  console.log(`Fetched ${list.length} ad server lists`)

  return list
}

async function deleteList(client: Cloudflare, listId: string) {
  return client.zeroTrust.gateway.lists.delete(listId, {
    account_id: process.env.CLOUDFLARE_ACCOUNT_ID!
  })
}

async function deleteExistingAdServerLists(client: Cloudflare) {
  const lists = await fetchAdServerLists(client)
  const promises = lists.map(({ id }, index) => async () =>  {
    console.log(`Deleting list ${index + 1} of ${lists.length}`)

    return deleteList(client, id!)
  })

  return runPromisesInSequence(promises)
}

async function createAdServerList(client: Cloudflare, name: string, items: string[]) {
  return client.zeroTrust.gateway.lists.create({
    account_id: process.env.CLOUDFLARE_ACCOUNT_ID!,
    name,
    description: AUTO_CREATED_DESCRIPTION,
    type: 'DOMAIN',
    items: items.map((value) => ({ value }))
  })
}

async function createAdServerLists(client: Cloudflare, items: string[]) {
  const chunks = chunk(items, LIST_ITESM_LIMIT)
  const promises = chunks.map((items, index) => async () => {
    console.log(`Creating list ${index + 1} of ${chunks.length}`)

    return createAdServerList(client, `Ad servers ${index + 1}`, items)
  })

  return runPromisesInSequence(promises)
}

async function fetchBlockAdsRule(client: Cloudflare) {
  console.log('Fetching block ads rule')

  const { result } = await client.zeroTrust.gateway.rules.list({
    account_id: process.env.CLOUDFLARE_ACCOUNT_ID!
  })

  return result.find(({ description }) => description === AUTO_CREATED_DESCRIPTION)
}

async function deleteRule(client: Cloudflare, ruleId: string) {
  console.log('Deleting block ads rule')

  return client.zeroTrust.gateway.rules.delete(ruleId, {
    account_id: process.env.CLOUDFLARE_ACCOUNT_ID!
  })
}

async function deleteExistingBlockAdsRule(client: Cloudflare) {
  const rule = await fetchBlockAdsRule(client)

  if (!rule) {
    return
  }

  return deleteRule(client, rule.id!)
}

async function createBlockAdsRule(client: Cloudflare) {
  const lists = await fetchAdServerLists(client)

  console.log('Creating block ads rule')

  return client.zeroTrust.gateway.rules.create({
    account_id: process.env.CLOUDFLARE_ACCOUNT_ID!,
    name: 'Block ads',
    description: AUTO_CREATED_DESCRIPTION,
    action: 'block',
    traffic: lists.map(({ id }) => `any(dns.domains[*] in $${id})`).join(' or '),
    enabled: true,
  })
}

const adservers = await fetchAdServers()
const cloudflare = new Cloudflare({ apiToken: process.env.CLOUDFLARE_TOKEN })

runPromisesInSequence([
  () => deleteExistingBlockAdsRule(cloudflare),
  () => deleteExistingAdServerLists(cloudflare),
  () => createAdServerLists(cloudflare, adservers.slice(0, AD_SERVERS_LIMIT)),
  () => createBlockAdsRule(cloudflare),
])
