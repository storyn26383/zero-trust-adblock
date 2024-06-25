import 'dotenv/config'
import Cloudflare from 'cloudflare'

const AD_SERVERS_LIMIT = 100000
const LIST_ITESM_LIMIT = 1000
const AUTO_CREATED_LIST_DESCRIPTION = '# auto created adservers list #'
const AUTO_CREATED_RULE_DESCRIPTION = '# auto created block ads rule #'

const CUSTOM_AD_SERVERS = [
  'm.vpon.com',
]

function chunk<T>(list: T[], size: number): T[][] {
  const result = []

  for (let i = 0; i < list.length; i += size) {
    result.push(list.slice(i, i + size))
  }

  return result
}

function unique<T>(list: T[]): T[] {
  return Array.from(new Set(list))
}

function flatten<T>(list: T[][]): T[] {
  return list.reduce((acc, value) => [...acc, ...value], [])
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
  const validDomainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/

  async function adguard() {
    const response = await fetch('https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt')
    const body = await response.text()
    const items = body.split('\n')
      .filter((line) => !line.match(/^!/) && line.includes('||'))
      .map((line) => line.replace(/^(?:@@)?\|\|(.+?)\^.*$/, '$1').trim())
      .filter((line) => line.match(validDomainRegex))

    return items
  }

  async function blacklist() {
    const response = await fetch('https://raw.githubusercontent.com/anudeepND/blacklist/master/adservers.txt')
    const body = await response.text()
    const items = body.split('\n')
      .filter((line) => !line.includes('#'))
      .map((line) => line.replace(/0\.0\.0\.0/, '').trim())
      .filter((line) => line.match(validDomainRegex))

    return items
  }

  const adservers = await Promise.all([
    adguard(),
    blacklist(),
  ])
  const uniqueAdservers = unique([
    ...CUSTOM_AD_SERVERS,
    ...flatten(adservers),
  ])

  console.log(`Fetched ${uniqueAdservers.length} ad servers`)

  return uniqueAdservers
}

async function fetchAdServerLists(client: Cloudflare) {
  const { result } = await client.zeroTrust.gateway.lists.list({
    account_id: process.env.CLOUDFLARE_ACCOUNT_ID!
  })

  const list = result.filter(({ id, description }) => id && description === AUTO_CREATED_LIST_DESCRIPTION)

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
    description: AUTO_CREATED_LIST_DESCRIPTION,
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

  return result.find(({ description }) => description === AUTO_CREATED_RULE_DESCRIPTION)
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
    description: AUTO_CREATED_RULE_DESCRIPTION,
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
