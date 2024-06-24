import 'dotenv/config'
import Cloudflare from 'cloudflare'

const cloudflare = new Cloudflare({
  apiToken: process.env.CLOUDFLARE_TOKEN,
})

const result = await cloudflare.user.tokens.verify()

console.log(result)
