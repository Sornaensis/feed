import {parsePublisherFeed} from '../../site/assets/live-feeds.js?v=1';
const order=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(order):Object.fromEntries(Object.keys(value).sort().map(key=>[key,order(value[key])])):value;
document.querySelector('#run').addEventListener('click',async()=>{
 document.querySelector('#run').disabled=true;const results=[];
 try{const fixtures=await (await fetch('../fixtures/live-feeds.json')).json();
 for(const sample of fixtures.cases){const actual=await parsePublisherFeed(sample.xml,sample.sourceId);const pass=JSON.stringify(order(actual))===JSON.stringify(order(sample.expectedPosts));results.push({source:sample.sourceId,posts:actual.length,pass,...(pass?{}:{actual,expected:sample.expectedPosts})});}
 }catch(e){results.push({error:e.message});}
 document.querySelector('#results').textContent=JSON.stringify(results,null,2);
});