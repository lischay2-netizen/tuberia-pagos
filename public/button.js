(function(){var s=document.currentScript,slug=s.getAttribute('data-project'),label=s.getAttribute('data-label')||'Pagar / Apoyar';
var base=new URL(s.src).origin,a=document.createElement('a');a.href=base+'/p/'+slug;a.target='_blank';a.textContent=label;
a.style.cssText='display:inline-block;background:#1a73e8;color:#fff;font:600 16px system-ui,sans-serif;padding:12px 22px;border-radius:999px;text-decoration:none;box-shadow:0 4px 14px rgba(0,0,0,.15)';
s.parentNode.insertBefore(a,s.nextSibling);})();
