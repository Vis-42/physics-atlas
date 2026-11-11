const labels={career:'Career leaders',frontier:'Frontier now',open:'Open to researchers'};
exports.selectResearchFilters=async(page,mode)=>{
 if(await page.getByRole('button',{name:'Institutions',exact:true}).getAttribute('aria-pressed')==='true')await page.getByRole('button',{name:'Researchers',exact:true}).click();
 const selected=mode.split('+');
 for(const f of selected)await page.getByRole('checkbox',{name:labels[f],exact:true}).check();
 for(const [f,name] of Object.entries(labels))if(!selected.includes(f))await page.getByRole('checkbox',{name,exact:true}).uncheck();
};
