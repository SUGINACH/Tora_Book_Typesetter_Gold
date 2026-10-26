/* Step-by-step layout audit: diagnostic-only page deltas around layout/repair stages. */
(function installStepByStepAudit() {
    const config = { enabled:true, maxEventsPerPage:4000, maxElementsPerSnapshot:1200, maxTextChars:180,
        captureLineRects:true, captureComputedStyle:true, ...(window.__stepByStepAuditConfig||{}) };
    const states = new Map(), round=n=>Number.isFinite(n)?Math.round(n*10)/10:null;
    const cls=el=>typeof el.className==='string'?el.className:(el.className?.baseVal||'');
    const txt=(el,n)=>String(el.getAttribute('data-raw-text')||el.getAttribute('aria-label')||el.textContent||'')
        .replace(/[\s\u200e\u200f]+/g,' ').trim().slice(0,n);
    const role=(el,c)=>{
        if(el.matches('.page-body-flow'))return'body-flow';if(el.matches('.page-content-wrapper'))return'page-wrapper';
        if(el.matches('.block-2col'))return'two-column-block';if(el.matches('.block-single-col'))return'single-column-block';
        if(el.matches('.block-h3-span'))return'full-width-heading-block';
        if(el.matches('.main-column'))return c.includes('right-col')?'right-column':'left-column';
        if(el.matches('.single-wide-col'))return'single-wide-column';
        if(el.matches('p'))return c.includes('p-cut')?'paragraph-continuation-cut':c.includes('p-end')?'paragraph-continuation-end':'paragraph';
        if(/title-level-2-standalone|title-level-\d|title-level-custom/.test(c))return'heading';
        if(el.matches('.footnote-area,.note-block,.note-line,.note-line-num'))return'footnote';
        if(el.matches('.side-note-anchor,.margin-notes-column'))return'side-note';
        if(/ornament/i.test(c))return'ornament';if(/divider|rule|sec-divider/i.test(c))return'divider';
        if(/note-marker/.test(c))return'note-marker';if(/paren-text/.test(c))return'parenthetical-run';
        if(/drop-cap/.test(c))return'drop-cap';if(el.matches('.top-header-grid,.header-col-r,.header-col-c,.header-col-l'))return'running-header';
        if(el.matches('.page-number-footer'))return'page-number';return'layout-element';
    };
    const attrRe=/^(data-token-id|data-is-cont|data-raw-text|data-side-note|data-end-note|data-note-style-id|data-note-level|data-layout-(balance-(called|status|skip-reason|routing|fallback|fallback-side|fallback-sparse-line|selection-policy|selected-candidate|diff|right|left|over)|split-(input-lines|fit-lines|placed-lines|min-first|min-last)|final-phase|final-diff|final-fits|final-justify-rollback-reason|global-justify-rolled-back|global-justify-rollback-reason|postfit-triggered|postfit-outer-overflow|postfit-inner-overflow|fill-remaining|fill-flow-height|fill-top-offset))$/;
    const selector=['.page-content-wrapper','.page-body-flow > *','p','[class*="title-level-"]','.block-2col','.block-single-col',
        '.block-h3-span','.main-column','.single-wide-col','.footnote-area','.note-block','.note-line','.note-line-num',
        '.side-note-anchor','.margin-notes-column','.sec-divider-wrap','[class*="ornament"]','[class*="divider"]','[class*="rule"]',
        '.top-header-grid','.header-col-r','.header-col-c','.header-col-l','.page-number-footer','.h2-spacer','.h2-siman-badge',
        '.paren-text','.note-marker','.drop-cap','.heading-run-in'].join(',');
    function lines(el,pr){
        if(!config.captureLineRects||!el.matches('p,[class*="title-level-"],.note-line'))return[];
        try{const range=document.createRange();range.selectNodeContents(el);const m=new Map();
            for(const r of range.getClientRects()){if(r.width<.1||r.height<.1)continue;const k=Math.round(r.top*2)/2;
                const b=m.get(k)||{l:r.left,r:r.right,t:r.top,b:r.bottom};b.l=Math.min(b.l,r.left);b.r=Math.max(b.r,r.right);
                b.t=Math.min(b.t,r.top);b.b=Math.max(b.b,r.bottom);m.set(k,b);}
            return Array.from(m.values()).sort((a,b)=>a.t-b.t).map(r=>({x:round(r.l-pr.left),y:round(r.t-pr.top),w:round(r.r-r.l),h:round(r.b-r.t)}));
        }catch(_){return[];}
    }
    function snapshot(page){
        const pr=page.getBoundingClientRect(),els=Array.from(new Set(page.querySelectorAll(selector))).slice(0,config.maxElementsPerSnapshot);
        const counts=new Map(),keys=new Map(),nodes=[];
        for(const el of els){const c=cls(el),id=el.getAttribute('data-token-id')||'',t=txt(el,config.maxTextChars);
            const b=el.id?'id:'+el.id:[el.tagName.toLowerCase(),c,id,t].join('|'),n=counts.get(b)||0;counts.set(b,n+1);keys.set(el,b+'#'+n);}
        for(const el of els){const c=cls(el),id=el.getAttribute('data-token-id')||'',t=txt(el,config.maxTextChars),r=el.getBoundingClientRect(),attrs={};
            for(const a of Array.from(el.attributes))if(attrRe.test(a.name))attrs[a.name]=a.value.slice(0,1200);
            let p=el.parentElement,parentKey=null;while(p&&p!==page){if(keys.has(p)){parentKey=keys.get(p);break;}p=p.parentElement;}
            const lr=lines(el,pr),node={key:keys.get(el),parentKey,tag:el.tagName.toLowerCase(),role:role(el,c),cls:c.slice(0,140),
                id:el.id||null,tokenId:id||null,text:t,rect:{x:round(r.left-pr.left),y:round(r.top-pr.top),w:round(r.width),h:round(r.height)},
                lineCount:lr.length,lineRects:lr,attributes:attrs};
            if(config.captureComputedStyle&&el.matches('p,[class*="title-level-"],.note-line,.paren-text,.note-marker')){
                const s=getComputedStyle(el);node.typography={fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,
                    lineHeight:s.lineHeight,textAlign:s.textAlign,textAlignLast:s.textAlignLast,whiteSpace:s.whiteSpace,
                    marginTop:s.marginTop,marginBottom:s.marginBottom,paddingTop:s.paddingTop,paddingBottom:s.paddingBottom,display:s.display};}
            nodes.push(node);}
        const f=page.querySelector('.page-body-flow')?.getBoundingClientRect(),n=page.querySelector('.footnote-area')?.getBoundingClientRect();
        return{nodes:new Map(nodes.map(x=>[x.key,x])),metrics:{page:{w:round(pr.width),h:round(pr.height)},
            bodyFlow:f?{y:round(f.top-pr.top),h:round(f.height),bottom:round(f.bottom-pr.top)}:null,
            footnoteArea:n?{y:round(n.top-pr.top),h:round(n.height),bottom:round(n.bottom-pr.top)}:null,
            twoColumnBlocks:page.querySelectorAll('.block-2col').length,
            bodyParagraphs:page.querySelectorAll('.main-column p,.single-wide-col p').length,
            noteLines:page.querySelectorAll('.footnote-area .note-line').length}};
    }
    function targetInfo(e){return e?.nodeType===1?{tag:e.tagName.toLowerCase(),cls:cls(e).slice(0,140),
        tokenId:e.getAttribute('data-token-id')||null,text:txt(e,config.maxTextChars)}:null;}
    function record(page,stage,phase,target,force){
        if(!config.enabled||!page?.classList?.contains('a4-page'))return;
        let s=states.get(page);if(!s){s={page,events:[],previous:null,droppedEvents:0,snapshotCount:0};states.set(page,s);}
        const now=snapshot(page);s.snapshotCount++;const prev=s.previous,added=[],removed=[],changed=[];
        if(prev){for(const[k,node]of now.nodes){const old=prev.nodes.get(k);if(!old)added.push(node);else if(JSON.stringify(old)!==JSON.stringify(node))changed.push({key:k,before:old,after:node});}
            for(const[k,node]of prev.nodes)if(!now.nodes.has(k))removed.push(node);}else added.push(...now.nodes.values());
        const metricsChanged=!prev||JSON.stringify(prev.metrics)!==JSON.stringify(now.metrics);s.previous=now;
        if(!force&&!added.length&&!removed.length&&!changed.length&&!metricsChanged)return;
        if(s.events.length>=config.maxEventsPerPage){s.droppedEvents++;return;}
        s.events.push({index:s.events.length,stage,phase,target:targetInfo(target),pageIndex:Array.from(document.querySelectorAll('#book-container .a4-page')).indexOf(page),
            pageLabel:page.querySelector('.page-number-footer')?.textContent?.trim()||null,pageMetricsBefore:prev?.metrics||null,
            pageMetricsAfter:now.metrics,delta:{added,removed,changed},deltaCounts:{added:added.length,removed:removed.length,changed:changed.length},
            noGeometryChange:!added.length&&!removed.length&&!changed.length&&!metricsChanged});}
    function pagesFor(name,args,result){const out=new Set(),add=v=>{if(!v)return;if(v.nodeType===1){
        if(v.classList?.contains('a4-page'))out.add(v);else{const p=v.closest?.('.a4-page');if(p)out.add(p);}return;}
        if(v.page?.nodeType===1)add(v.page);if(v.bodyFlow?.nodeType===1)add(v.bodyFlow);if(v.elem?.nodeType===1)add(v.elem);};
        if(name==='createPageLayout')add(result?.page);
        else if(['repositionOverflowingSideNotes','fitColumnDividers','applyCrossParagraphParens'].includes(name)){
            const root=args.find(v=>v?.nodeType===1);if(root){if(root.matches?.('.a4-page'))out.add(root);else{
                const own=root.closest?.('.a4-page');if(own)out.add(own);root.querySelectorAll?.('.a4-page').forEach(p=>out.add(p));}}}
        else{args.forEach(add);add(result?.page);}return Array.from(out);}
    function wrap(name,fn,force=false,targetFn=null){if(typeof fn!=='function'||fn.__stepByStepAuditWrapped)return fn;
        const wrapped=function(...args){const before=pagesFor(name,args,null),target=targetFn?targetFn(args):args[0]?.nodeType===1?args[0]:null;
            before.forEach(p=>record(p,name,'before',target,force));let result;
            try{result=fn.apply(this,args);}catch(error){pagesFor(name,args,null).forEach(p=>record(p,name,'throw',target,true));throw error;}
            pagesFor(name,args,result).forEach(p=>record(p,name,'after',targetFn?targetFn(args,result):target,force||name==='createPageLayout'));return result;};
        Object.defineProperty(wrapped,'__stepByStepAuditWrapped',{value:true});return wrapped;}
    if(!config.enabled)return;
    createPageLayout=wrap('createPageLayout',createPageLayout);
    renderSingleItemFast=wrap('renderSingleItemFast',renderSingleItemFast);
    balanceColumns=wrap('balanceColumns',balanceColumns,true);
    justifyColumnVertically=wrap('justifyColumnVertically',justifyColumnVertically,true);
    shrinkColumnVertically=wrap('shrinkColumnVertically',shrinkColumnVertically,true);
    tryReclaimOrphanTail=wrap('tryReclaimOrphanTail',tryReclaimOrphanTail,true);
    flushFootnotesInto=wrap('flushFootnotesInto',flushFootnotesInto,true);
    repositionOverflowingSideNotes=wrap('repositionOverflowingSideNotes',repositionOverflowingSideNotes,true);
    fitSectionDividerToPage=wrap('fitSectionDividerToPage',fitSectionDividerToPage,true);
    fitColumnDividers=wrap('fitColumnDividers',fitColumnDividers,true);
    repositionBlockNotes=wrap('repositionBlockNotes',repositionBlockNotes,true);
    stretchLastBlockToBottom=wrap('stretchLastBlockToBottom',stretchLastBlockToBottom,true);
    applyCrossParagraphParens=wrap('applyCrossParagraphParens',applyCrossParagraphParens,true);
    recordLayoutGeometryStage=wrap('recordLayoutGeometryStage',recordLayoutGeometryStage,true,args=>args[0]?.nodeType===1?args[0]:null);
    const api={version:1,config:{...config},configure:o=>{Object.assign(config,o||{});api.config={...config};},reset:()=>states.clear(),
        export:()=>Array.from(states.values()).map(s=>({pageIndex:Array.from(document.querySelectorAll('#book-container .a4-page')).indexOf(s.page),
            pageLabel:s.page.querySelector('.page-number-footer')?.textContent?.trim()||null,eventCount:s.events.length,
            droppedEvents:s.droppedEvents,snapshotCount:s.snapshotCount,events:s.events})).sort((a,b)=>a.pageIndex-b.pageIndex)};
    window.__stepByStepAudit=api;
})();