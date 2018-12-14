const request = require('request-promise')
const cheerio = require('cheerio')
const path = require('path')
const fs = require('fs')
const {promisify} = require('util')
const PromisePool = require('es6-promise-pool')

const writeFileAsync = promisify(fs.writeFile)
const concurrency = 4
const prefix = 'https://no.wikipedia.org'
const downloaded = fs.readdirSync(path.resolve(__dirname, 'out'))

const parseDownloadLink = html => {
  const $ = cheerio.load(html)

  const found = $('.fullMedia > p > a')
    .first()
    .attr('href')

  return found
    ? (found.substr(0, 2) === '//' ? `https:${found}` : found)
    : null
}

const parsePage = html => {
  const $ = cheerio.load(html)

  const found = $('a')
    .filter((index, link) => $(link).attr('title') === 'Våpen')
    .first()
    .attr('href')

  return found ? prefix + found : null
}

const parseIndex = html => {
  const $ = cheerio.load(html)

  return $('#mw-content-text h2')
    .map((index, header) => {
      return $(header).next().find('td > a:last-child')
        .map((childIndex, child) => {
          const county = $(header).find('.mw-headline').text()
          const municipality = $(child).text()
          const filename = `${county} - ${municipality}.svg`

          return {
            county,
            municipality,
            filename,
            url: prefix + $(child).attr('href'),
            success: false
          }
        })
        .get()
    })
    .get()
    .reduce((carry, item) => ([...carry, item]), [])
    .filter(item => {
      if (downloaded.indexOf(item.filename) !== -1) {
        console.info('Skipping', item.filename)

        return false
      }

      return true
    })
}

const downloadImage = (url, page) =>
  request(url)
    .then(res => writeFileAsync(
      path.resolve(__dirname, 'out', page.filename), res
    ))
    .then(() => true)
    .catch(err => {
      console.warn(url, err)
      return false
    })

const requestPage = page =>
  request(page.url)
    .then(parsePage)
    .then(uri => {
      return uri
        ? request(uri)
          .then(parseDownloadLink)
          .then(url => downloadImage(url, page))
          .then(success => (page.success = success))
        : Promise.resolve()
    })

const printStats = items => {
  const failures = items
    .filter(iter => !iter.success)
    .map(iter => `${iter.name} (${iter.url})`)

  const successes = items.length - failures.length

  if (failures.length) {
    failures.forEach(item => console.warn('Failed to get', item))
  }

  console.log(`${successes} successes`)
}


request('https://no.wikipedia.org/wiki/Wikipedia:V%C3%A5pengalleri/Kommunev%C3%A5pen')
  .then(parseIndex)
//  .then(items => items.splice(0, 10))
  .then(items => {
    console.log('Found', items.length)
    const pool = new PromisePool(function * () {
      for (let i = 0; i < items.length; i++) {
        const iter = items[i]
        console.log(`Fetching ${iter.county} - ${iter.municipality}`)
        yield requestPage(iter)
      }
    }, concurrency)

    return pool.start()
      .then(() => printStats(items))
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
