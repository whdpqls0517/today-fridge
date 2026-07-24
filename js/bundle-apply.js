(function(){
  const id=new URLSearchParams(location.search).get("id"); const product=window.FridgeDB.getProducts().find(p=>p.id===id); const form=document.getElementById("bundle-apply-form"); let quantity=1;
  const token=()=>{const d=localStorage.getItem("todayFridgeAccessToken");if(d)return d;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith("sb-")&&k.endsWith("-auth-token")){try{const v=JSON.parse(localStorage.getItem(k));if(v?.access_token)return v.access_token;if(v?.currentSession?.access_token)return v.currentSession.access_token}catch(_){}}}return null};
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  function renderAmount(){
    const stock=Math.max(0,Number(product?.stock)||0);
    const maxAllowed=Math.max(1,Math.min(Number(product?.maxQuantity)||10,stock||1));
    document.getElementById("apply-quantity").textContent=quantity;
    document.getElementById("apply-amount").textContent=`${(Number(product?.price||0)*quantity).toLocaleString("ko-KR")}원`;
    const minus=document.querySelector('[data-quantity="-1"]');
    const plus=document.querySelector('[data-quantity="1"]');
    if(minus)minus.disabled=quantity<=1;
    if(plus)plus.disabled=stock<=0||quantity>=maxAllowed;
  }
  if(!product||product.category!=="bundle"){form.hidden=true;document.getElementById("apply-message").textContent="신청 가능한 보따리 상품이 아닙니다.";return}
  document.getElementById("apply-product").innerHTML=`<img src="${product.image}" alt=""><div><strong>${product.name}</strong><span>1개 ${Number(product.price).toLocaleString("ko-KR")}원 · 남은 수량 ${product.stock}개</span></div>`;
  const startMatch=String(product.pickupDate||"").match(/(20\d{2})-(\d{2})-(\d{2})/); const start=startMatch?new Date(+startMatch[1],+startMatch[2]-1,+startMatch[3]):new Date(); const days=["일","월","화","수","목","금","토"]; let options=[];
  for(let n=0;n<7;n++){const d=new Date(start);d.setDate(d.getDate()+n);options.push(d)}
  document.getElementById("apply-date-options").innerHTML=options.map((d,i)=>`<label><input type="radio" name="pickupDate" value="${iso(d)}" ${i===0?"checked":""}><span><b>${d.getMonth()+1}.${d.getDate()}</b><small>${days[d.getDay()]}요일</small></span></label>`).join("");
  if(product.prepaymentOnly){const onsite=document.querySelector('input[value="onsite"]');onsite.disabled=true;document.getElementById("onsite-choice").classList.add("is-disabled");document.querySelector('input[value="transfer"]').checked=true;document.getElementById("payment-help").textContent="신선도 관리 상품으로 선결제만 가능합니다."}
  function paymentUI(){document.getElementById("depositor-field").hidden=document.querySelector('input[name="paymentType"]:checked')?.value!=="transfer"}
  document.querySelectorAll('input[name="paymentType"]').forEach(x=>x.addEventListener("change",paymentUI)); paymentUI();
  document.querySelectorAll("[data-quantity]").forEach(b=>b.addEventListener("click",()=>{
    const stock=Math.max(0,Number(product.stock)||0);
    const maxAllowed=Math.max(1,Math.min(Number(product.maxQuantity)||10,stock||1));
    quantity=Math.max(1,Math.min(maxAllowed,quantity+Number(b.dataset.quantity)));
    renderAmount();
  }));renderAmount();
  if((Number(product.stock)||0)<=0){
    const submit=document.querySelector(".apply-submit");
    submit.disabled=true;
    submit.textContent="신청 가능한 수량이 없어요";
    document.getElementById("apply-message").textContent="재고가 추가되면 다시 신청할 수 있어요.";
  }
  document.querySelector("[data-apply-back]").onclick=()=>history.back();
  form.addEventListener("submit",async e=>{e.preventDefault();const paymentType=document.querySelector('input[name="paymentType"]:checked').value;const payload={bundleItemId:product.bundleItemId,quantity,paymentType,pickupDate:document.querySelector('input[name="pickupDate"]:checked').value,pickupTimeLabel:document.querySelector('input[name="pickupTime"]:checked').value,depositorName:document.getElementById("depositor-name").value.trim()||window.FridgeDB.getUserAccount()?.name||""};try{let order;if(product.bundleItemId&&token()){const r=await fetch(`${location.origin}/api/orders`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token()}`},body:JSON.stringify(payload)});const j=await r.json();if(!r.ok||!j.success)throw new Error(j.error||"신청하지 못했습니다.");order=j.data}else{order={id:`order-${Date.now()}`,productId:product.id,bundleItemId:product.bundleItemId,productName:product.name,quantity,price:product.price*quantity,paymentType,transferApproved:false,paymentStatus:"pending",status:"pending",pickupDateISO:payload.pickupDate,pickupDate:payload.pickupDate,pickupTime:payload.pickupTimeLabel,depositorName:payload.depositorName,arrivalStatus:product.arrivalStatus,createdAt:new Date().toISOString()};window.FridgeDB.addOrder(order)}sessionStorage.setItem("todayFridgeLastOrder",JSON.stringify({...order,productName:product.name,totalAmount:product.price*quantity,paymentType,pickupDate:payload.pickupDate,pickupTimeLabel:payload.pickupTimeLabel,depositorName:payload.depositorName}));location.href="./bundle-apply-complete.html"}catch(err){document.getElementById("apply-message").textContent=err.message||"신청하지 못했습니다."}});
})();
