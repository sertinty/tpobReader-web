/* ============================================================
   TPOB Reader Web - app.js
   精确匹配 Android 端交互逻辑
   ============================================================ */

// ==================== IndexedDB ====================
const DB_NAME = 'tpob-reader-db';
const DB_VERSION = 1;
const STORE = 'books';

function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(STORE)) {
        e.target.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    r.onsuccess = (e) => resolve(e.target.result);
    r.onerror = (e) => reject(e.target.error);
  });
}

async function getAllBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).getAll();
    r.onsuccess = () => resolve(r.result.sort((a, b) => b.importTime - a.importTime));
    r.onerror = () => reject(r.error);
  });
}

async function saveBook(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const r = tx.objectStore(STORE).put(book);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function deleteBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const r = tx.objectStore(STORE).delete(id);
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
}

async function getBookById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const r = tx.objectStore(STORE).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// ==================== .tpob 解析器 ====================
async function parseTPOB(file) {
  const zip = await JSZip.loadAsync(file);
  const book = { id: Date.now(), importTime: Date.now() };

  const metaFile = zip.file('book.json');
  if (!metaFile) throw new Error('book.json 不存在');
  const meta = JSON.parse(await metaFile.async('string'));
  book.title = meta.title || '未命名';
  book.author = meta.author || '';
  book.description = meta.description || '';

  const mdFile = zip.file('content.md');
  if (!mdFile) throw new Error('content.md 不存在');
  const rawMd = await mdFile.async('string');

  const imgMap = {};
  const imgFiles = zip.file(/^images\//);
  for (const f of imgFiles) {
    if (f.dir) continue;
    const name = f.name.replace('images/', '');
    const ext = name.split('.').pop().toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
    imgMap[name] = 'data:' + mime + ';base64,' + await f.async('base64');
  }

  book.markdown = rawMd.replace(
    /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
    (_, alt, name) => imgMap[name] ? '![' + alt + '](' + imgMap[name] + ')' : '![' + alt + '](images/' + name + ')'
  );

  var coverName = (meta.cover || '').replace('images/', '');
  book.cover = imgMap[coverName] || '';

  return book;
}

// ==================== DOM 引用 ====================
var $ = function(s) { return document.querySelector(s); };
var el = {
  header: $('#header'),
  headerTitle: $('#header-title'),
  btnBack: $('#btn-back'),
  btnTheme: $('#btn-theme'),
  iconNight: $('#icon-night'),
  iconDay: $('#icon-day'),
  viewLibrary: $('#view-library'),
  viewReader: $('#view-reader'),
  booksGrid: $('#books-grid'),
  emptyHint: $('#empty-hint'),
  btnImport: $('#btn-import'),
  fileInput: $('#file-input'),
  readerContent: $('#reader-content'),
  loading: $('#loading'),
  loadingText: $('#loading-text'),
  dialog: $('#dialog'),
  dialogTitle: $('#dialog-title'),
  dialogText: $('#dialog-text'),
  dialogCancel: $('#dialog-cancel'),
  dialogConfirm: $('#dialog-confirm'),
};

var currentView = 'library';
var currentBookId = null;

// ==================== 主题 ====================
function initTheme() {
  if (localStorage.getItem('tpob-theme') === 'dark') {
    document.body.classList.add('dark');
    el.iconNight.classList.add('hidden');
    el.iconDay.classList.remove('hidden');
    el.btnTheme.title = '日间模式';
  }
}
function toggleTheme() {
  var dark = document.body.classList.toggle('dark');
  localStorage.setItem('tpob-theme', dark ? 'dark' : 'light');
  el.iconNight.classList.toggle('hidden', dark);
  el.iconDay.classList.toggle('hidden', !dark);
  el.btnTheme.title = dark ? '日间模式' : '夜间模式';
  // 重新渲染阅读器以应用颜色
  if (currentView === 'reader' && currentBookId) {
    renderReader(currentBookId);
  }
}

// ==================== Toast ====================
function toast(msg) {
  var t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(function() { t.remove(); }, 2000);
}

// ==================== 加载 ====================
function showLoading(msg) {
  el.loadingText.textContent = msg;
  el.loading.classList.remove('hidden');
}
function hideLoading() { el.loading.classList.add('hidden'); }

// ==================== 对话框 (match AlertDialog) ====================
function showDialog(title, text, onConfirm) {
  el.dialogTitle.textContent = title;
  el.dialogText.textContent = text;
  el.dialog.classList.remove('hidden');
  el.dialogConfirm.onclick = function() { el.dialog.classList.add('hidden'); onConfirm(); };
  el.dialogCancel.onclick = function() { el.dialog.classList.add('hidden'); };
}

// ==================== 视图切换 ====================
function showLibrary() {
  currentView = 'library';
  currentBookId = null;
  el.viewLibrary.classList.remove('hidden');
  el.viewReader.classList.add('hidden');
  el.btnBack.classList.add('hidden');
  el.btnTheme.classList.add('hidden');
  el.headerTitle.textContent = '书架';
  el.btnImport.classList.remove('hidden');
  renderLibrary();
}

function showReader(bookId) {
  currentView = 'reader';
  currentBookId = bookId;
  el.viewLibrary.classList.add('hidden');
  el.viewReader.classList.remove('hidden');
  el.btnBack.classList.remove('hidden');
  el.btnTheme.classList.remove('hidden');
  el.btnImport.classList.add('hidden');
  renderReader(bookId);
}

// ==================== 书架 ====================
async function renderLibrary() {
  var books = await getAllBooks();
  el.booksGrid.innerHTML = '';
  if (books.length === 0) {
    el.booksGrid.classList.add('hidden');
    el.emptyHint.classList.remove('hidden');
  } else {
    el.booksGrid.classList.remove('hidden');
    el.emptyHint.classList.add('hidden');
    for (var i = 0; i < books.length; i++) {
      (function(book) {
        var card = document.createElement('div');
        card.className = 'book-card';
        card.innerHTML =
          '<div class="book-cover">' + (book.cover
            ? '<img src="' + book.cover + '" alt="">'
            : '<span class="book-cover-placeholder">' + esc(book.title.slice(0, 3)) + '</span>'
          ) + '</div>' +
          '<div class="book-title">' + esc(book.title) + '</div>' +
          (book.author ? '<div class="book-author">' + esc(book.author) + '</div>' : '');

        card.addEventListener('click', function() { showReader(book.id); });

        var timer;
        card.addEventListener('pointerdown', function() {
          timer = setTimeout(function() {
            showDialog('删除书籍', '确定要删除\u300C' + book.title + '\u300D吗？', async function() {
              await deleteBook(book.id);
              toast('已删除');
              renderLibrary();
            });
          }, 600);
        });
        card.addEventListener('pointerup', function() { clearTimeout(timer); });
        card.addEventListener('pointerleave', function() { clearTimeout(timer); });
        card.addEventListener('pointercancel', function() { clearTimeout(timer); });

        el.booksGrid.appendChild(card);
      })(books[i]);
    }
  }
}

// ==================== 阅读器 ====================
async function renderReader(bookId) {
  var book = await getBookById(bookId);
  if (!book) { showLibrary(); return; }
  el.headerTitle.textContent = book.title;
  el.readerContent.innerHTML = marked.parse(book.markdown || '');
}

// ==================== 导入 ====================
async function handleImport(file) {
  if (!file) return;
  showLoading('正在导入...');
  try {
    var book = await parseTPOB(file);
    await saveBook(book);
    hideLoading();
    toast('导入成功');
    renderLibrary();
  } catch (err) {
    hideLoading();
    toast('导入失败');
    console.error(err);
  }
}

// ==================== 工具 ====================
function esc(s) {
  var d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ==================== 事件 ====================
el.btnTheme.addEventListener('click', toggleTheme);
el.btnBack.addEventListener('click', showLibrary);
el.btnImport.addEventListener('click', function() { el.fileInput.click(); });
el.fileInput.addEventListener('change', function(e) { handleImport(e.target.files[0]); e.target.value = ''; });

document.addEventListener('dragover', function(e) { e.preventDefault(); });
document.addEventListener('drop', function(e) {
  e.preventDefault();
  var f = e.dataTransfer.files[0];
  if (f && (f.name.endsWith('.tpob') || f.name.endsWith('.zip'))) handleImport(f);
});

// ==================== 启动 ====================
initTheme();
renderLibrary();