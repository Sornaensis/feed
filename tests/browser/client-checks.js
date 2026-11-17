const endpoints = [{"id": "hn", "url": "https://hacker-news.firebaseio.com/v0/topstories.json", "kind": "json"}, {"id": "dev", "url": "https://dev.to/api/articles?per_page=2", "kind": "json"}, {"id": "ars", "url": "https://feeds.arstechnica.com/arstechnica/index", "kind": "xml"}, {"id": "verge", "url": "https://www.theverge.com/rss/index.xml", "kind": "xml"}, {"id": "techcrunch", "url": "https://techcrunch.com/feed/", "kind": "xml"}, {"id": "slashdot", "url": "https://rss.slashdot.org/Slashdot/slashdotMain", "kind": "xml"}, {"id": "bbc", "url": "https://feeds.bbci.co.uk/news/world/rss.xml", "kind": "xml"}, {"id": "guardian", "url": "https://www.theguardian.com/world/rss", "kind": "xml"}, {"id": "npr", "url": "https://feeds.npr.org/1001/rss.xml", "kind": "xml"}, {"id": "aljazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml", "kind": "xml"}, {"id": "dw", "url": "https://rss.dw.com/rdf/rss-en-all", "kind": "xml"}, {"id": "register", "url": "https://www.theregister.com/headlines.atom", "kind": "xml"}, {"id": "wired", "url": "https://www.wired.com/feed/rss", "kind": "xml"}, {"id": "pbs", "url": "https://www.pbs.org/newshour/feeds/rss/headlines", "kind": "xml"}, {"id": "propublica", "url": "https://www.propublica.org/feeds/propublica/main", "kind": "xml"}, {"id": "sciencedaily", "url": "https://www.sciencedaily.com/rss/top.xml", "kind": "xml"}, {"id": "media404", "url": "https://www.404media.co/rss/", "kind": "xml"}, {"id": "lobsters", "url": "https://lobste.rs/hottest.json", "kind": "json"}, {"id": "bluesky", "url": "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=arstechnica.com&limit=2", "kind": "json"}, {"id": "mastodon", "url": "https://mastodon.social/api/v1/timelines/tag/technology?limit=2", "kind": "json"}];
const results=[]; const payloads=new Map(); const samples={};
async function check(test) {
 const start=performance.now(); const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),15000);
 let result={source:test.id,url:test.url};
 try {
  const r=await fetch(test.url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer',signal:ctl.signal});
  if(!r.ok) throw new Error('HTTP '+r.status);
  const reader=r.body.getReader(); let chunks=[],size=0;
  while(true){const p=await reader.read();if(p.done)break;size+=p.value.length;if(size>2097152){await reader.cancel();throw new Error('Response over 2 MiB');}chunks.push(p.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const body=new TextDecoder().decode(bytes);let count;
  if(test.kind==='xml'){
   const doc=new DOMParser().parseFromString(body,'application/xml');if(doc.querySelector('parsererror'))throw new Error('Invalid XML');
   const entries=[...doc.getElementsByTagName('*')].filter(e=>['item','entry'].includes(e.localName));count=entries.length;if(!count)throw new Error('No feed entries');
   samples[test.id]=entries.slice(0,3).map(e=>new XMLSerializer().serializeToString(e));
  } else {const data=JSON.parse(body);payloads.set(test.id,data);count=Array.isArray(data)?data.length:data.feed?.length ?? data.descendants?.length ?? (data.thread ? 1 : data.id ? 1 : 0);}
  result={...result,pass:true,status:r.status,finalUrl:r.url,bytes:size,items:count};
 }catch(e){result={...result,pass:false,error:e.name==='AbortError'?'Timed out after 15 seconds':e.message};}
 finally{clearTimeout(timer);}
 result.elapsedMs=Math.round(performance.now()-start);results.push(result);
 const tr=document.createElement('tr');for(const value of [result.source,result.pass?'Readable':'Unavailable',result.pass?`${result.items} items · ${result.bytes} bytes`:result.error]){const td=document.createElement('td');td.textContent=value;tr.append(td);}tr.className=result.pass?'pass':'fail';document.querySelector('#results').append(tr);
 return result;
}
document.querySelector('#run').addEventListener('click',async()=>{
 document.querySelector('#run').disabled=true;document.querySelector('#status').textContent='Running';
 let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<endpoints.length)await check(endpoints[next++]);}));
 if(!results.find(r=>r.source==='register')?.pass)await check({id:'register-direct',url:'https://api.theregister.com/api/v1/article?orderBy=published&site_id=2&remapper=rss&content=node',kind:'xml'});
 const b=payloads.get('bluesky')?.feed?.[0]?.post;
 if(b?.uri)await check({id:'bluesky-thread',url:'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?'+new URLSearchParams({uri:b.uri,depth:6,parentHeight:0}),kind:'json'});
 const m=payloads.get('mastodon')?.[0];const status=m?.reblog||m;
 if(status?.id){await check({id:'mastodon-status',url:`https://mastodon.social/api/v1/statuses/${status.id}`,kind:'json'});await check({id:'mastodon-thread',url:`https://mastodon.social/api/v1/statuses/${status.id}/context`,kind:'json'});}
 document.querySelector('#report').textContent=JSON.stringify({checkedAt:new Date().toISOString(),origin:location.origin,results,samples},null,2);
 document.querySelector('#status').textContent='Complete';
});
