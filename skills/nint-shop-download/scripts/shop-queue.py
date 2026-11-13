"""Serial shop download gate. Does not drive browsers or send network requests."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse, parse_qs
import xml.etree.ElementTree as ET
import zipfile
import openpyxl


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def file_stat(path):
    s = Path(path).stat()
    return {'size':s.st_size,'mtimeNs':s.st_mtime_ns,'inode':s.st_ino}


def normalized(name):
    return re.sub(r'\s+', '', str(name or '')).casefold()


def verify_identity(shop, args):
    require(normalized(args.observed_search_name) == normalized(shop['searchName']), '搜索结果掌柜名与榜单不符')
    if shop.get('shopName'):
        require(normalized(args.observed_shop_name) == normalized(shop['shopName']), '搜索结果店铺名与清单不符')
    else:
        require(bool(args.observed_shop_name), '缺少可见店铺名')
        shop['shopName'] = args.observed_shop_name
    u = urlparse(args.detail_url or '')
    require(u.scheme == 'https' and (u.hostname == 'nint.com' or (u.hostname or '').endswith('.nint.com')), '详情链接必须来自情报通可见搜索结果')
    require(u.path.startswith('/shop-ali') and args.sid and args.sid.isdigit() and parse_qs(u.query).get('sid') == [args.sid], '详情链接 sid 与观察值不符')
    return {'nintSid':args.sid,'detailUrl':args.detail_url,'observedSearchName':args.observed_search_name,
            'observedShopName':args.observed_shop_name,'sourceShopUrl':shop['shopUrl']}


def verify(file, sid, expected_period=None):
    p = Path(file).resolve()
    initial_stat = file_stat(p)
    require(p.suffix.lower() == '.xlsx', '要求 XLSX 文件')
    with zipfile.ZipFile(p) as z:
        require(z.testzip() is None, 'ZIP 损坏')
        require('xl/workbook.xml' in z.namelist(), '不是 XLSX 工作簿')
        media = [n for n in z.namelist() if n.startswith('xl/media/') and not n.endswith('/')]
        anchors = []
        ns = {'d':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'}
        for name in z.namelist():
            if re.fullmatch(r'xl/drawings/drawing\d+\.xml', name):
                xml = ET.fromstring(z.read(name))
                for anchor in xml:
                    if anchor.find('d:pic', ns) is not None:
                        row = anchor.find('d:from/d:row', ns)
                        require(row is not None, '图片不是可核验的单元格锚点')
                        anchors.append(int(row.text))
        require(all(z.getinfo(n).file_size > 0 for n in media), '嵌入图片为空')
    w = openpyxl.load_workbook(p, read_only=True, data_only=True)
    try:
        require({'QBT','下载条件'} <= set(w.sheetnames), '缺少 QBT 或下载条件')
        conditions = dict(list(w['下载条件'].values)[1:])
        require(conditions.get('模块') == '店铺分析-宝贝列表', '不是店铺商品表')
        require(str(conditions.get('店铺ID')) == str(sid), '下载文件店铺 ID 不符')
        period = conditions.get('时间范围')
        require(bool(period), '缺少商品表自身时间范围')
        if expected_period:
            require(period == expected_period, '商品表实际时间范围与要求不符')
        rows = list(w['QBT'].values)
        require(bool(rows), '数据表为空')
        header = rows[0]
        require({'宝贝名称','链接','宝贝图片','本月销量','上月销量'} <= set(header), '商品表表头异常')
        data = rows[1:]
        require(0 < len(data) <= 3000, '商品数量异常；空表需单独核实，不自动算成功')
        name_col, link_col = header.index('宝贝名称'), header.index('链接')
        require(all(r[name_col] and r[link_col] for r in data), '存在空商品名或链接')
        require(len(anchors) == len(data), '图片锚点数和商品数不符')
        require(len(set(anchors)) == len(data), '存在重复商品行图片或缺图')
        require(set(anchors) == set(range(1,len(data)+1)), '图片未逐行对应商品')
        require(bool(media), '没有嵌入图片')
        sha256 = digest(p)
        require(initial_stat == file_stat(p), '文件仍在变化，等待下载完整结束')
        return {'file':str(p), 'sha256':sha256, 'fileStat':initial_stat, 'rows':len(data), 'pictures':len(anchors),
                'embeddedMediaFiles':len(media), 'conditions':conditions, 'actualPeriod':period,
                'limitReached':len(data) == 3000, 'zipIntegrity':True}
    finally:
        w.close()


def validate_source(q):
    p = q.get('sourceWorkbook')
    require(p and Path(p).is_file(), '队列来源工作簿不存在')
    require(q.get('sourceWorkbookSha256') == digest(p), '队列来源未绑定哈希或已改变；重新核验，不能接着下载')
    if q.get('sourceKind') == 'shop-list':
        if Path(p).suffix == '.json':
            names = json.loads(Path(p).read_text())['shops']
        else:
            book = openpyxl.load_workbook(p, read_only=True, data_only=True)
            names = [str(r[0]).strip() for r in book.active.values if r[0]]
            book.close()
        require(len(names) == len(q['shops']) and len(set(map(normalized,names))) == len(names), '默认清单重复或数量不符')
        require(all(s['rank']==i and normalized(s['searchName'])==normalized(n) for i,(s,n) in enumerate(zip(q['shops'],names),1)), '队列与固定清单不一致')
        return
    w = openpyxl.load_workbook(p, read_only=True, data_only=True)
    try:
        data = list(w['QBT'].values)[1:]
        shops = q['shops']
        require(len(shops) == len(data) == 100, '队列必须对应已核验的前100榜单')
        for item, row in zip(shops, data):
            require((item['rank'],item['searchName'],item['shopName'],item['shopUrl']) == (row[0],row[1],row[2],row[5]), '队列与来源榜单不一致')
    finally:
        w.close()


def first_unfinished(q, full=False):
    for i, shop in enumerate(q['shops']):
        if shop.get('status') == 'unavailable':
            require(shop.get('reason') and shop.get('authorization'), '缺失项需要原因和用户授权记录')
            continue
        if shop.get('status') != 'verified':
            return i, shop
        evidence = shop.get('verification', {})
        file = evidence.get('file')
        require(file and Path(file).is_file(), f'已完成店铺文件缺失：{shop["rank"]}')
        changed = file_stat(file) != evidence.get('fileStat')
        if full or changed:
            require(digest(file) == evidence.get('sha256'), f'已完成店铺文件改变：{shop["rank"]}')
            evidence['fileStat'] = file_stat(file)
        require(str(evidence.get('conditions',{}).get('店铺ID')) == shop.get('identity',{}).get('nintSid'), '已完成记录与情报通店铺不符')
    return None, None


def save(path, q):
    q['updatedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    fd, tmp = tempfile.mkstemp(prefix='.queue-', suffix='.json', dir=path.parent)
    try:
        with os.fdopen(fd,'w') as f:
            json.dump(q,f,ensure_ascii=False,indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['next','audit','begin','accept','fail','skip','verify-file'])
    parser.add_argument('--queue',type=Path)
    parser.add_argument('--rank',type=int)
    parser.add_argument('--sid')
    parser.add_argument('--detail-url')
    parser.add_argument('--observed-search-name')
    parser.add_argument('--observed-shop-name')
    parser.add_argument('--file',type=Path)
    parser.add_argument('--expected-period')
    parser.add_argument('--reason')
    parser.add_argument('--authorization')
    args=parser.parse_args()
    if args.action == 'verify-file':
        require(args.file and args.sid, 'verify-file 需要 --file 和 --sid')
        print(json.dumps(verify(args.file,args.sid,args.expected_period),ensure_ascii=False)); return
    require(args.queue and args.queue.is_file(), '需要存在的 --queue')
    with open(str(args.queue)+'.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        q=json.loads(args.queue.read_text())
        validate_source(q)
        idx, shop=first_unfinished(q, full=args.action == 'audit')
        if args.action in ['next','audit']:
            save(args.queue,q)
            print(json.dumps({'complete':shop is None,'shop':shop},ensure_ascii=False)); return
        require(shop is not None, '所有店铺已经完成')
        require(shop['rank'] == args.rank, '禁止跳过当前店铺或并发处理下一家')
        if args.action == 'begin':
            require(shop.get('status') in ['pending','failed'], '当前店铺已有下载进行中，先核实文件和浏览器下载状态')
            identity=verify_identity(shop,args)
            shop.update(status='downloading',expectedPeriod=args.expected_period,identity=identity)
            shop['attempts']=shop.get('attempts',0)+1
        elif args.action == 'accept':
            require(shop.get('status') == 'downloading', '只有当前下载中的店铺可验收')
            require(args.file is not None, 'accept 需要 --file')
            report=verify(args.file,shop['identity']['nintSid'],shop.get('expectedPeriod'))
            allowed={normalized(shop['searchName']),normalized(shop['shopName'])}
            require(normalized(report['conditions'].get('店铺名')) in allowed, '下载条件店铺名与榜单不符')
            shop.update(status='verified',verification=report)
            shop.pop('failure',None)
        elif args.action == 'skip':
            require(args.reason and args.authorization, '缺失记录需要明确原因及用户授权')
            require(shop.get('status') in ['pending','failed'], '下载仍在进行中不能跳过')
            shop.update(status='unavailable',reason=args.reason,authorization=args.authorization)
        elif args.action == 'fail':
            require(args.reason, '失败必须记录实际原因')
            require(shop.get('status') == 'downloading', '仅能标记当前下载任务失败')
            shop.update(status='failed',failure=args.reason)
        q['status']='complete' if all(s.get('status')=='verified' for s in q['shops']) else 'complete_with_missing' if all(s.get('status') in ['verified','unavailable'] for s in q['shops']) else 'shops_in_progress'
        save(args.queue,q)
        print(json.dumps({'rank':shop['rank'],'status':shop['status'],'verification':shop.get('verification')},ensure_ascii=False))


if __name__ == '__main__':
    main()
