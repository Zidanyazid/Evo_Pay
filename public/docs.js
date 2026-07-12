const snippets={curl:`curl -X POST http://localhost:3000/api/v1/payments \\
  -H "Authorization: Bearer API_KEY" \\
  -H "Idempotency-Key: order-10001" \\
  -H "Content-Type: application/json" \\
  -d '{"order_id":"TOPUP-10001","amount":15000,"payment_method":"qris"}'`,javascript:`const response = await fetch('/api/v1/payments', {
  method: 'POST',
  headers: { Authorization: 'Bearer API_KEY', 'Idempotency-Key': 'order-10001', 'Content-Type': 'application/json' },
  body: JSON.stringify({ order_id: 'TOPUP-10001', amount: 15000, payment_method: 'qris' })
});
const payment = await response.json();`,php:`$response = file_get_contents('http://localhost:3000/api/v1/payments', false, stream_context_create([
  'http' => ['method' => 'POST', 'header' => "Authorization: Bearer API_KEY\\r\\nContent-Type: application/json\\r\\nIdempotency-Key: order-10001", 'content' => json_encode(['order_id'=>'TOPUP-10001','amount'=>15000,'payment_method'=>'qris'])]
]));`,python:`import requests
response = requests.post('http://localhost:3000/api/v1/payments',
  headers={'Authorization':'Bearer API_KEY','Idempotency-Key':'order-10001'},
  json={'order_id':'TOPUP-10001','amount':15000,'payment_method':'qris'})
print(response.json())`};
const snippet=document.querySelector('#snippet');const label=document.querySelector('#code-label');function select(lang){snippet.textContent=snippets[lang];label.textContent=lang;document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('active',b.dataset.lang===lang))}select('curl');document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=()=>select(b.dataset.lang));async function copy(text,button){const old=button.dataset.label||'Copy';button.textContent='Copied ✓';button.classList.add('copied');try{if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).catch(()=>{});else{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove()}}finally{setTimeout(()=>{button.textContent=old;button.classList.remove('copied')},3000)}}document.querySelector('#copy-code').dataset.label='Copy code';document.querySelector('#copy-code').onclick=e=>copy(snippet.textContent,e.currentTarget);document.querySelectorAll('[data-copy]').forEach(b=>{b.dataset.label='Copy';b.onclick=()=>copy(b.dataset.copy,b)});document.querySelector('#theme').onclick=()=>document.body.classList.toggle('light');
