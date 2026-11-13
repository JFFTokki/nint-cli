import sys, json, zipfile, hashlib, calendar
from pathlib import Path
import openpyxl

source, month, destination = sys.argv[1:]
p = Path(source)
with zipfile.ZipFile(p) as z:
    assert z.testzip() is None, '文件 ZIP 完整性检查失败'
    assert 'xl/workbook.xml' in z.namelist(), '下载内容不是 XLSX 工作簿'
w = openpyxl.load_workbook(p, read_only=True, data_only=True)
assert {'QBT', '下载条件'} <= set(w.sheetnames), '缺少数据或下载条件表'
rows = list(w['QBT'].values)
conditions = list(w['下载条件'].values)
c = dict(conditions[1:])
assert c['模块'] == '行业分析-热销店铺-店铺详细数据', c
assert c['查看范围'] == '天猫全部', c
assert c['时间范围'] == f'{month} ~ {month}', c
assert c['类目名'] == '童装/婴儿装/亲子装', c
assert str(c['类目ID']) == '50008165', c
headers, data = rows[0], rows[1:]
idx = {v: i for i, v in enumerate(headers)}
assert len(data) >= 100, f'仅有 {len(data)} 家'
assert [r[idx['排名']] for r in data] == list(range(1, len(data)+1)), '排名不连续'
sales = [r[idx['销量']] for r in data]
assert all(isinstance(v, (int,float)) for v in sales), '销量不是数值'
assert all(a >= b for a, b in zip(sales, sales[1:])), '不是销量降序'
year, m = map(int, month.split('-'))
period = f'{month}-01~{month}-{calendar.monthrange(year,m)[1]}'
assert all(r[idx['时间维度']] == period for r in data), '商品月份不符'
assert len({r[idx['掌柜链接']] for r in data[:100]}) == 100, '前100存在重复店铺'
payload = {'month': month, 'source': str(p.resolve()), 'sourceSha256': hashlib.sha256(p.read_bytes()).hexdigest(),
           'headers': headers, 'rows': data[:100], 'conditions': conditions,
           'verification': {'rawRows':len(data), 'selectedRows':100, 'rankRange':[1,100], 'salesDescending': True, 'uniqueShops':100, 'period':period, 'conditions':c, 'zipIntegrity':True}}
Path(destination).write_text(json.dumps(payload, ensure_ascii=False, indent=2))
print(json.dumps(payload['verification'], ensure_ascii=False))
