const express = require('express')
const path = require('path');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const JSDOM = require("jsdom").JSDOM;

dotenv.config();

const app = express()
const port = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use(cors());

const checkTitle = (title, query) => {
  if (!title) return false;
  const queryParts = query.split(' ');
  var successTermsCount = 0;
  for (let i = 0; i < queryParts.length; i++) {
    if (title.toLowerCase().includes(queryParts[i].toLowerCase())) successTermsCount += 1;
  }
  return queryParts.length == successTermsCount;
}

var LOGOS = {
  'Amazon Prime Video': 'https://m.media-amazon.com/images/G/01/digital/video/acquisition/amazon_video_light_on_dark.png',
  'Canal + Sport': 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Canal%2B_Sport_2015.png',
  'Canal +': 'https://www.groupe-campus.com/wp-content/uploads/2019/07/canal-logo-png-transparent.png',
};

const parseChannelProg = (channelData, currentDateString, lastUpdateTimeZone) => {
    var isNotRightlyParsed = false;
    var parseErrorIndex = 0;
    const channelProg = channelData.map((prog, index) => {

        if (isNotRightlyParsed) return null;
        if (prog == '\t   ') {
          isNotRightlyParsed = true;
          parseErrorIndex = index;
          return null;
        }

        // Parse and Format time
        var timeString = prog.split(' ')[0].replace(';',':');

        var time = currentDateString + " " + timeString + " " + lastUpdateTimeZone;
        time = new Date(time).toISOString();

        // Parse program datas
        var channelName, country, title;
        if (prog.includes('(') || prog.includes(')')) {
          var temp = prog.split('(');
          channelName = temp.length === 3 ? temp[1].trim() : temp[1].replace(')','').trim();
          country = temp.length === 3 ? temp[2].replace(')','').trim() : 'English';
        }
        else {
          var temp = prog.split(' ')[1].split(':');
          channelName = temp.length === 2 ? temp[0].trim() : null
          country = 'English';
        }

        // Parse and Format title
        title = prog.trim()
        if (timeString) title = title.replace(timeString, '').trim();
        if (channelName) title = title.replace(channelName, '').trim();
        if (country) title = title.replace(country, '').trim();
        title = title.split('(').join('').trim().split(')').join('').trim().split(':').join('').trim().replace('   ', ' ').trim();

        return {
          title,
          time,
          channelName,
          country
        }
    });
    if (isNotRightlyParsed) return {
      'error': true,
      'index': parseErrorIndex,
      'channelProg': channelProg
    }
    else return {
      'error': false,
      'channelProg': channelProg
    }
  };

app.get('/', function (req, res, next) {
  res.render('pages/index')
});

app.get('/stream/:chId', async function (req, res, next) {

  const response = await axios.get(`https://ragnaru.net/embed.php?player=desktop&live=do${req.params.chId}`, {
    headers: {
      Referer: 'https://1.vecdn.pw/'
    }
  });
  const scriptStr = response.data.split('return([')[1].split('.join("")')[0]
  const source = new Function('return([' + scriptStr + '.join(""))')()
  console.log(source)
  const sourceUrlObj = new URL(source);

  const streamingUrl = `/api/m3u8?server=${sourceUrlObj.host}&streamId=${sourceUrlObj.pathname.split('/')[2].split('.m3u8')[0]}&playerType=u&${sourceUrlObj.searchParams.toString()}`;

  res.render('pages/stream', {
    streamingUrl
  })

})

app.get('/api/search', async (req, res) => {

  if (!req.query.q) return res.status(400).json({
    error: "query/missing"
  })

  const query = req.query.q;

  var results = [];

  try {

    const response = await axios.get('https://1.vecdn.pw/program.php');

    data = JSDOM.fragment(response.data).querySelector('div.container').textContent;
    var channels = data.split('\n\n\n\n');
    channels.pop();

    var headers = channels.shift().split('\n').splice(11,13);
    var lastUpdate = headers[0]
    var lastUpdateTimeZone = lastUpdate.split(' | ')[1].split(' ')[2];
    var lastUpdateYear = lastUpdate.split(' | ')[0].split(' ')[4].split('.')[2];
    channels.unshift(headers[2]);

    var currentDateString;
    var channelResults = [];

    channels.every(channel => {

      var channelData = channel.trim().split('\n');
      // remove empty lines in channelData
      channelData = channelData.filter(line => (line.length > 0 && line !== ' '));

      //Check if empty, if not, find the date
      if (channelData.length === 1) {
        if (channelData[0].includes('📅')) {
          var date = channelData[0].split('-')[1].trim();
          currentDateString = date + " " + lastUpdateYear;
          return true;
        }
      }

      //If not empty or a date, find the channel name and the programs
      var channelId = channelData[0].split('/')[3].split('.')[0].replace('ch', '');
      channelData.splice(0,8);

      // Parse the programs
      var parsed = {index: -1};
      var finishedParsing = false;
      while (!finishedParsing) {
        if (parsed.error) {
          channelId = channelData.slice(parsed.index+1)[0].split('\t').join('').trim().split('/')[3].split('.')[0].replace('ch', '');
          channelData.splice(parsed.index+1, parsed.index+5);
        }
        parsed = parseChannelProg(channelData.slice(parsed.index+1), currentDateString, lastUpdateTimeZone);
        var channelProg = parsed.channelProg.filter(prog => prog !== null);
        elemInResults = channelResults.find(obj => obj.channelId === channelId)
        elemInResults ? elemInResults.channelProg = elemInResults.channelProg.concat(channelProg) : channelResults.push({channelId, channelProg});
        finishedParsing = !parsed.error;
      }

      return true;

    });

    for (var i = 0; i < channelResults.length; i++) {
      var channel = channelResults[i];
      for (var j = 0; j < channel.channelProg.length; j++) {
        var prog = channel.channelProg[j];
        if (checkTitle(prog.title, query) || checkTitle(prog.channelName, query)) {
          var thumbnail;
          if (!LOGOS[prog.channelName]) {
            var websiteDomain = (await axios.get('https://autocomplete.clearbit.com/v1/companies/suggest?query=' + prog.channelName)).data
            thumbnail = websiteDomain[0] ? websiteDomain[0].logo : 'https://dino-chrome.com/static/images/dino.jpg';
            LOGOS[prog.channelName] = thumbnail;
          } else {
            thumbnail = LOGOS[prog.channelName];
          }
          results.push({
            id: channel.channelId,
            title: prog.title,
            time: prog.time,
            channelName: prog.channelName,
            thumbnail,
            country: prog.country,
            provider: "vpw"
          });
        }
      }
    }
  } catch (err) {
    return res.status(500).json({
      error: "server/error"
    })
  }

  res.json(results);

});

app.get('/api/m3u8', async (req, res) => {

  if (!req.query.server || !req.query.streamId || !req.query.playerType) return res.status(400).json({
    error: 'request/missing-query'
  })

  const {server, streamId, playerType, ...remainingQueries} = req.query;

  const streamingUrl = `https://${server}/hls/${streamId}.m3u8?${new URLSearchParams(remainingQueries).toString()}`;
  console.log(streamingUrl);
  var headers = {
    Referer: 'https://ragnar' + playerType + '.net/',
  };
  if ('if-modified-since' in req.headers) headers['if-modified-since'] = req.headers['if-modified-since'];
  if ('if-none-match' in req.headers) headers['if-none-match'] = req.headers['if-none-match'];
  const response = await axios.get(streamingUrl, {
    headers
  }).catch(err => {
    return err;
  });

  if (response.isAxiosError) {
    console.log(`Axios Error - Code: ${response.response.status}`);
    if (response.response.status == 404) {
      return res.status(504).json({
        error: 'stream/offline'
      })
    }
  }

  var m3u8 = response.data.split(streamId).join(`ts/${streamId}`);
  m3u8 = m3u8.split('.ts').join(`.ts?${new URLSearchParams({server, playerType}).toString()}`);

  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.sendDate = true;
  res.send(m3u8);

});

app.get('/api/ts/:filename', async (req, res) => {

  if (!req.query.server || !req.query.playerType) return res.status(400).json({
    error: 'request/missing-query'
  })

  const server = req.query.server;
  const playerType = req.query.playerType;

  const requestUrl = `https://${server}/hls/${req.params.filename}`;

  const response = await axios.get(requestUrl, {
    responseType: "stream",
    headers: {
      Referer: 'https://ragnar' + playerType + '.net/',
    }
  });

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Etag', response.headers['etag']);
  res.setHeader('Last-Modified', response.headers['last-modified']);
  res.sendDate = true;
  response.data.pipe(res);
});

app.listen(port, () => {
  console.log(`Live Sport started on port ${port}`);
});
