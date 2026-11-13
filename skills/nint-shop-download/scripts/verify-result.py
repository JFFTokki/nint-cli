import json, sys, zipfile, hashlib
from pathlib import Path
import openpyxl

out=Path(sys.argv[1])
p=json.loads((out/'source-verified.json').read_text())
file=out/f'童装_婴儿装_亲子装_天猫_热销店铺前100_销量_{p["month"]}.xlsx'
with zipfile.ZipFile(file) as z:
    assert z.testzip() is None
w=openpyxl.load_workbook(file,read_only=True,data_only=True)
actual=list(w['QBT'].values)
expected=[p['headers']]+p['rows']
assert len(actual)==101 and len(actual[0])==13
for i,(a,b) in enumerate(zip(actual,expected)):
    for j,(v,ref) in enumerate(zip(a,b)):
        if isinstance(ref,(int,float)):
            assert isinstance(v,(int,float)) and abs(v-ref)<=max(1e-8,abs(ref)*1e-14),(i,j,v,ref)
        else:
            assert v==ref,(i,j,v,ref)
conditions=list(w['下载条件'].values)
assert [list(r) for r in conditions[:len(p['conditions'])]]==p['conditions']
queue=json.loads((out/'店铺下载队列.json').read_text())
assert len(queue['shops'])==100
assert [s['searchName'] for s in queue['shops']]==[r[1] for r in p['rows']]
assert all(s['status']=='pending' for s in queue['shops'])
report={**p['verification'],'file':str(file.resolve()),'all1300DataCellsMatchSource':True,'conditionsPreserved':True,'queueMatches':True,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()}
(out/'核验结果.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=False))
