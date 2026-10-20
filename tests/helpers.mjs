export function fixtureHtml(showPassword = true) {
  return `<!doctype html><meta charset="utf-8"><title>本地测试 fixture</title>
  <p>仅用于自动化测试的模拟页面</p>
  <input id="generic" placeholder="测试关键词">
  ${showPassword?'<input id="sensitive" type="password" value="fixture-secret-value">':''}
  <select id="choose"><option value="a">选项一</option><option value="b">选项二</option></select>
  <label><input id="tick" type="checkbox" style="position:absolute;width:0;height:0;opacity:0"><span>模拟复选框</span></label>
  <input id="file" type="file" style="display:none"><button id="victim">原来的按钮</button>
  <a id="download" download="fixture.csv" href="data:text/csv;charset=utf-8,a%2Cb%0A1%2C2">下载 fixture</a>
  <a id="popup" target="_blank" href="https://art.nint.com/popup">新页面</a>
  <div id="shadow-host"></div><iframe srcdoc="<button id='inside'>frame 按钮</button>"></iframe>
  <script>document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<button id="shadow-button">shadow 按钮</button>';</script>`;
}
