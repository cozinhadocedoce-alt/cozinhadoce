function p(o,n,e){const r=$=>[1,3,5].map(t=>parseInt($.slice(t,t+2),16)),[l,c]=[r(o),r(n)];return"#"+l.map(($,t)=>Math.round($+(c[t]-$)*e).toString(16).padStart(2,"0")).join("")}const y=(o,n,e,r,l)=>{const c=o-e/2,$=o+e/2,t=e/300,f=n-30*t,a=n+30*t,d=(i,s)=>{const g=(e-8*t)/16;let x=`M${c+4*t} ${i}`;for(let h=0;h<16;h++)x+=` q${g/2} ${s*9*t} ${g} 0`;return`${x} L${$-4*t} ${i-s*14*t} L${c+4*t} ${i-s*14*t} Z`};return`<g><defs><linearGradient id="t${l}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${r[0]}"/><stop offset="1" stop-color="${r[1]}"/></linearGradient></defs>
    <rect x="${c+16*t}" y="${f+6*t}" width="${e-32*t}" height="${a-f-12*t}" rx="${18*t}" fill="${r[3]}"/>
    <path d="${d(f+6*t,1)}" fill="${r[2]}"/><path d="${d(a-6*t,-1)}" fill="${r[2]}"/>
    <path d="M${c} ${f-6*t} C${c} ${f-112*t} ${$} ${f-112*t} ${$} ${f-6*t} Q${o} ${f+2*t} ${c} ${f-6*t}Z" fill="url(#t${l})"/>
    <ellipse cx="${o-58*t}" cy="${f-56*t}" rx="${50*t}" ry="${15*t}" fill="#fff" opacity=".6" transform="rotate(-10 ${o-58*t} ${f-56*t})"/>
    <path d="M${c} ${a+6*t} Q${o} ${a-2*t} ${$} ${a+6*t} C${$} ${a+72*t} ${c} ${a+72*t} ${c} ${a+6*t}Z" fill="url(#t${l})"/></g>`};function m(o="#e5568a",n=!1){const e=p(o,"#ffb36b",.45),r=p(o,"#2a0d16",.3),l=p(o,"#000000",.55);return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${e}"/><stop offset=".55" stop-color="${o}"/><stop offset="1" stop-color="${r}"/></linearGradient></defs>
  <rect width="512" height="512" rx="${n?112:0}" fill="url(#bg)"/>
  <g fill="#fff" opacity=".35"><circle cx="96" cy="110" r="10"/><circle cx="420" cy="92" r="7"/><circle cx="440" cy="410" r="11"/><circle cx="80" cy="400" r="6"/></g>
  <g transform="rotate(14 340 170)">${y(340,170,170,["#c9f1e3","#8fd9bf","#7cc9ad","#fff7ec"],"m")}</g>
  <ellipse cx="244" cy="428" rx="150" ry="16" fill="${l}" opacity=".25"/>
  ${y(240,316,290,["#fff0f5","#ffc2d4","#f59bb6","#7a4a32"],"p")}
  <g fill="#f6c454"><circle cx="210" cy="232" r="4"/><circle cx="236" cy="222" r="3"/><circle cx="292" cy="238" r="3.5"/><circle cx="262" cy="214" r="2.5"/><circle cx="320" cy="226" r="2.5"/></g>
</svg>`}const u=(o,n=!0)=>"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(m(o,n));async function v(o,n){const e=new Image;e.src=u(o,!1),await e.decode();const r=document.createElement("canvas");return r.width=r.height=n,r.getContext("2d").drawImage(e,0,0,n,n),new Promise((l,c)=>r.toBlob($=>$?l($):c(new Error("Não foi possível criar o ícone.")),"image/png"))}export{u as iconDataUrl,v as iconPng,m as iconSvg,p as mix};
