/* ============================================================
   TPOB Reader Web - app.js
   IndexedDB + .tpob 解析 + 书架 + 阅读器 + 夜间模式
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

  // 图片 -> base64
  const imgMap = {};
  const imgFiles = zip.file(/^images\//);
  for (const f of imgFiles) {
    if (f.dir) continue;
    const name = f.name.replace('images/', '');
    const ext = name.split('.').pop().toLowerCase();
    const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }[ext] || 'image/png';
    const data = await f.async('base64');
    imgMap[name] = `data:${mime};base64,${data}`;
  }

  book.markdown = rawMd.replace(
    /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
    (_, alt, name) => imgMap[name] ? `![${alt}](${imgMap[name]})` : `![${alt}](images/${name})`
  );

  const coverName = (meta.cover || '').replace('images/', '');
  book.cover = imgMap[coverName] || '';

  return book;
}

// ==================== DOM 引用 ====================
const $ = (s) => document.querySelector(s);
const el = {
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
  dialogText: $('#dialog-text'),
  dialogCancel: $('#dialog-cancel'),
  dialogConfirm: $('#dialog-confirm'),
};

let currentView = 'library';
let currentBookId = null;

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
  const dark = document.body.classList.toggle('dark');
  localStorage.setItem('tpob-theme', dark ? 'dark' : 'light');
  el.iconNight.classList.toggle('hidden', dark);
  el.iconDay.classList.toggle('hidden', !dark);
  el.btnTheme.title = dark ? '日间模式' : '夜间模式';
}

// ==================== Toast ====================
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

// ==================== 加载提示 ====================
function showLoading(msg) {
  el.loadingText.textContent = msg;
  el.loading.classList.remove('hidden');
}
function hideLoading() { el.loading.classList.add('hidden'); }

// ==================== 对话框 ====================
function showDialog(text, onConfirm) {
  el.dialogText.textContent = text;
  el.dialog.classList.remove('hidden');
  el.dialogConfirm.onclick = () => { el.dialog.classList.add('hidden'); onConfirm(); };
  el.dialogCancel.onclick = () => { el.dialog.classList.add('hidden'); };
}

// ==================== 视图切换 ====================
function showLibrary() {
  currentView = 'library';
  currentBookId = null;
  el.viewLibrary.classList.remove('hidden');
  el.viewReader.classList.add('hidden');
  el.btnBack.classList.add('hidden');
  el.headerTitle.textContent = 'TPOB 阅读器';
  el.btnImport.classList.remove('hidden');
  renderLibrary();
}
function showReader(bookId) {
  currentView = 'reader';
  currentBookId = bookId;
  el.viewLibrary.classList.add('hidden');
  el.viewReader.classList.remove('hidden');
  el.btnBack.classList.remove('hidden');
  el.btnImport.classList.add('hidden');
  renderReader(bookId);
}

// ==================== 书架 ====================
async function renderLibrary() {
  const books = await getAllBooks();
  el.booksGrid.innerHTML = '';
  if (books.length === 0) {
    el.booksGrid.classList.add('hidden');
    el.emptyHint.classList.remove('hidden');
  } else {
    el.booksGrid.classList.remove('hidden');
    el.emptyHint.classList.add('hidden');
    for (const book of books) {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML =
        `<div class="book-cover">${book.cover
          ? `<img src="${book.cover}" alt="">`
          : `<span class="book-cover-placeholder">${esc(book.title.slice(0, 3))}</span>`
        }</div>
        <div class="book-title">${esc(book.title)}</div>
        ${book.author ? `<div class="book-author">${esc(book.author)}</div>` : ''}`;

      card.addEventListener('click', () => showReader(book.id));

      let timer;
      card.addEventListener('pointerdown', () => {
        timer = setTimeout(() => {
          showDialog('确定要删除\u300C' + book.title + '\u300D吗？', async () => {
            await deleteBook(book.id);
            toast('已删除');
            renderLibrary();
          });
        }, 600);
      });
      card.addEventListener('pointerup', () => clearTimeout(timer));
      card.addEventListener('pointerleave', () => clearTimeout(timer));
      card.addEventListener('pointercancel', () => clearTimeout(timer));

      el.booksGrid.appendChild(card);
    }
  }
}

// ==================== 阅读器 ====================
async function renderReader(bookId) {
  const book = await getBookById(bookId);
  if (!book) { showLibrary(); return; }
  el.headerTitle.textContent = book.title;
  el.readerContent.innerHTML = marked.parse(book.markdown || '');
}

// ==================== 导入 ====================
async function handleImport(file) {
  if (!file) return;
  showLoading('正在导入...');
  try {
    const book = await parseTPOB(file);
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
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ==================== 事件 ====================
el.btnTheme.addEventListener('click', toggleTheme);
el.btnBack.addEventListener('click', showLibrary);
el.btnImport.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', (e) => { handleImport(e.target.files[0]); e.target.value = ''; });

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && (f.name.endsWith('.tpob') || f.name.endsWith('.zip'))) handleImport(f);
});

// ==================== 启动 ====================
initTheme();
renderLibrary();