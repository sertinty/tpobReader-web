/* ============================================================
   TPOB Reader Web - app.js
   IndexedDB 存储 + .tpob 解析 + 书架 + 阅读器 + 夜间模式
   ============================================================ */

// ==================== IndexedDB ====================
const DB_NAME = 'tpob-reader-db';
const DB_VERSION = 1;
const STORE_NAME = 'books';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

async function getAllBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.importTime - a.importTime));
    req.onerror = () => reject(req.error);
  });
}

async function saveBook(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(book);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deleteBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function getBookById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ==================== .tpob 解析器 ====================
async function parseTPOB(file) {
  const zip = await JSZip.loadAsync(file);
  const book = { id: Date.now(), importTime: Date.now() };

  // 解析 book.json
  const bookJsonFile = zip.file('book.json');
  if (!bookJsonFile) throw new Error('book.json 不存在');
  const bookJson = JSON.parse(await bookJsonFile.async('string'));
  book.title = bookJson.title || '未命名';
  book.author = bookJson.author || '';
  book.description = bookJson.description || '';

  // 解析 content.md
  const contentFile = zip.file('content.md');
  if (!contentFile) throw new Error('content.md 不存在');
  const rawMarkdown = await contentFile.async('string');

  // 提取图片到 base64
  const imageMap = {};
  const imageFiles = zip.file(/^images\//);
  for (const imgFile of imageFiles) {
    if (imgFile.dir) continue;
    const name = imgFile.name.replace('images/', '');
    const ext = name.split('.').pop().toLowerCase();
    const mimeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
    const mime = mimeMap[ext] || 'image/png';
    const data = await imgFile.async('base64');
    imageMap[name] = `data:${mime};base64,${data}`;
  }

  // 替换 Markdown 中的图片路径为 base64
  book.markdown = rawMarkdown.replace(
    /!\[([^\]]*)\]\(images\/([^)]+)\)/g,
    (match, alt, imgName) => {
      if (imageMap[imgName]) return `![${alt}](${imageMap[imgName]})`;
      return `![${alt}](images/${imgName})`;
    }
  );

  // 封面
  const coverName = bookJson.cover ? bookJson.cover.replace('images/', '') : '';
  book.cover = imageMap[coverName] || '';

  return book;
}

// ==================== UI 状态 ====================
let currentView = 'library';
let currentBookId = null;
let deleteTargetId = null;

// DOM 元素
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const elHeader = $('#header');
const elHeaderTitle = $('#header-title');
const elBtnBack = $('#btn-back');
const elBtnTheme = $('#btn-theme');
const elViewLibrary = $('#view-library');
const elViewReader = $('#view-reader');
const elBooksGrid = $('#books-grid');
const elEmptyHint = $('#empty-hint');
const elBtnImport = $('#btn-import');
const elFileInput = $('#file-input');
const elReaderContent = $('#reader-content');
const elLoading = $('#loading');
const elLoadingText = $('#loading-text');
const elDialog = $('#dialog');
const elDialogText = $('#dialog-text');
const elDialogCancel = $('#dialog-cancel');
const elDialogConfirm = $('#dialog-confirm');

// ==================== 主题 ====================
function initTheme() {
  const saved = localStorage.getItem('tpob-theme');
  if (saved === 'dark') document.body.classList.add('dark');
  updateThemeBtn();
}
function toggleTheme() {
  document.body.classList.toggle('dark');
  localStorage.setItem('tpob-theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  updateThemeBtn();
}
function updateThemeBtn() {
  elBtnTheme.textContent = document.body.classList.contains('dark') ? '☀️' : '🌙';
}

// ==================== Toast ====================
function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 2000);
}

// ==================== 加载提示 ====================
function showLoading(msg) {
  elLoadingText.textContent = msg;
  elLoading.classList.remove('hidden');
}
function hideLoading() {
  elLoading.classList.add('hidden');
}

// ==================== 对话框 ====================
function showDialog(text, onConfirm) {
  elDialogText.textContent = text;
  elDialog.classList.remove('hidden');
  elDialogConfirm.onclick = () => {
    elDialog.classList.add('hidden');
    onConfirm();
  };
  elDialogCancel.onclick = () => { elDialog.classList.add('hidden'); };
}

// ==================== 视图切换 ====================
function showLibrary() {
  currentView = 'library';
  currentBookId = null;
  elViewLibrary.classList.remove('hidden');
  elViewReader.classList.add('hidden');
  elBtnBack.classList.add('hidden');
  elHeaderTitle.textContent = 'TPOB 阅读器';
  elBtnImport.classList.remove('hidden');
  renderLibrary();
}
function showReader(bookId) {
  currentView = 'reader';
  currentBookId = bookId;
  elViewLibrary.classList.add('hidden');
  elViewReader.classList.remove('hidden');
  elBtnBack.classList.remove('hidden');
  elBtnImport.classList.add('hidden');
  renderReader(bookId);
}

// ==================== 书架 ====================
async function renderLibrary() {
  const books = await getAllBooks();
  elBooksGrid.innerHTML = '';

  if (books.length === 0) {
    elBooksGrid.classList.add('hidden');
    elEmptyHint.classList.remove('hidden');
  } else {
    elBooksGrid.classList.remove('hidden');
    elEmptyHint.classList.add('hidden');
    books.forEach(book => {
      const card = document.createElement('div');
      card.className = 'book-card';
      card.innerHTML = `
        <div class="book-cover">
          ${book.cover
            ? `<img src="${book.cover}" alt="${escHtml(book.title)}">`
            : `<span class="book-cover-placeholder">${escHtml(book.title.slice(0, 3))}</span>`
          }
        </div>
        <div class="book-title">${escHtml(book.title)}</div>
        ${book.author ? `<div class="book-author">${escHtml(book.author)}</div>` : ''}
      `;
      // 点击打开
      card.addEventListener('click', () => showReader(book.id));
      // 长按删除
      let longPressTimer;
      card.addEventListener('pointerdown', () => {
        longPressTimer = setTimeout(() => {
          showDialog(`确定删除「${book.title}」吗？`, async () => {
            await deleteBook(book.id);
            showToast('已删除');
            renderLibrary();
          });
        }, 600);
      });
      card.addEventListener('pointerup', () => clearTimeout(longPressTimer));
      card.addEventListener('pointerleave', () => clearTimeout(longPressTimer));
      elBooksGrid.appendChild(card);
    });
  }
}

// ==================== 阅读器 ====================
async function renderReader(bookId) {
  const book = await getBookById(bookId);
  if (!book) { showLibrary(); return; }

  elHeaderTitle.textContent = book.title;
  elReaderContent.innerHTML = marked.parse(book.markdown || '');
}

// ==================== 导入 ====================
async function handleImport(file) {
  if (!file) return;
  showLoading('正在导入…');
  try {
    const book = await parseTPOB(file);
    await saveBook(book);
    hideLoading();
    showToast(`导入成功：《${book.title}》`);
    renderLibrary();
  } catch (err) {
    hideLoading();
    showToast('导入失败：' + err.message);
  }
}

// ==================== 工具 ====================
function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==================== 事件绑定 ====================
elBtnTheme.addEventListener('click', toggleTheme);
elBtnBack.addEventListener('click', showLibrary);
elBtnImport.addEventListener('click', () => elFileInput.click());
elFileInput.addEventListener('change', (e) => {
  handleImport(e.target.files[0]);
  e.target.value = '';
});

// 拖放导入
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (file && (file.name.endsWith('.tpob') || file.name.endsWith('.zip'))) {
    handleImport(file);
  }
});

// ==================== 启动 ====================
initTheme();
renderLibrary();