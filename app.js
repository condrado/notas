const state = {
  directoryHandle: null,
  notes: [],
  folders: [],
  groupColors: {},
  noteOrder: [],
  draggedNote: null,
  collapsedFolders: new Set(),
  currentNote: null,
  saveTimer: null,
  isDirty: false,
};

const NOTES_DIRECTORY_NAME = 'notas-data';
const GROUP_CONFIG_FILE = '.notas-config.json';
const DIRECTORY_DATABASE_NAME = 'notas';
const DIRECTORY_STORE_NAME = 'handles';
const GROUP_COLORS = [
  '#6b7280', '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#06b6d4',
  '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#78716c', '#0f766e',
];

const elements = {
  openFolder: document.querySelector('#open-folder-button'),
  welcomeOpen: document.querySelector('#welcome-open-button'),
  newNote: document.querySelector('#new-note-button'),
  newFolder: document.querySelector('#new-folder-button'),
  save: document.querySelector('#save-button'),
  delete: document.querySelector('#delete-button'),
  search: document.querySelector('#search-input'),
  notesList: document.querySelector('#notes-list'),
  emptyNotes: document.querySelector('#empty-notes'),
  notesCount: document.querySelector('#notes-count'),
  folderName: document.querySelector('#folder-name'),
  folderStatus: document.querySelector('#folder-status'),
  currentNoteLabel: document.querySelector('#current-note-label'),
  saveStatus: document.querySelector('#save-status'),
  welcomeView: document.querySelector('#welcome-view'),
  noteView: document.querySelector('#note-view'),
  title: document.querySelector('#note-title'),
  folderSelect: document.querySelector('#note-folder'),
  toast: document.querySelector('#toast'),
};

const Font = Quill.import('formats/font');
Font.whitelist = ['sans-serif', 'serif', 'monospace', 'code'];
Quill.register(Font, true);

const quill = new Quill('#editor', {
  theme: 'snow',
  placeholder: 'Empieza a escribir...',
  modules: {
    toolbar: [
      [{ font: ['sans-serif', 'serif', 'monospace', 'code'] }],
      [{ header: [1, 2, 3, false] }],
      ['bold', 'italic', 'underline', 'strike'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ color: [] }, { background: [] }],
      ['blockquote', 'code-block', 'link', 'image'],
      ['clean'],
    ],
    resize: {
      modules: ['DisplaySize', 'Resize'],
      parchment: {
        image: {
          attribute: ['width'],
          limit: { minWidth: 100 },
        },
      },
    },
  },
});

if ('serviceWorker' in navigator && ['http:', 'https:'].includes(window.location.protocol)) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (error) {
      console.warn('No se pudo registrar la aplicación instalable.', error);
    }
  });
}

function setSaveStatus(message, type = '') {
  elements.saveStatus.textContent = message;
  elements.saveStatus.className = `save-status ${type}`.trim();
}

function showToast(message, isError = false) {
  elements.toast.textContent = message;
  elements.toast.className = `toast visible${isError ? ' error' : ''}`;
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => {
    elements.toast.className = 'toast';
  }, 4000);
}

function sanitizeFileName(title) {
  const cleanTitle = title.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ');
  return (cleanTitle || 'Nota sin título').slice(0, 100);
}

function noteTitleFromFileName(fileName) {
  return fileName.replace(/\.json$/i, '') || 'Nota sin título';
}

function formatDate(timestamp) {
  if (!timestamp) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'numeric', year: '2-digit' }).format(new Date(timestamp));
}

function isJsonFile(fileName) {
  return fileName.toLowerCase().endsWith('.json') && fileName !== GROUP_CONFIG_FILE;
}

async function verifyPermission(handle, readWrite = false) {
  const options = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(options)) === 'granted') return true;
  return (await handle.requestPermission(options)) === 'granted';
}

const directoryDatabase = new Promise((resolve, reject) => {
  const request = window.indexedDB.open(DIRECTORY_DATABASE_NAME, 1);
  request.addEventListener('upgradeneeded', () => {
    request.result.createObjectStore(DIRECTORY_STORE_NAME);
  });
  request.addEventListener('success', () => resolve(request.result));
  request.addEventListener('error', () => reject(request.error));
});

async function storeDirectoryHandle(handle) {
  const database = await directoryDatabase;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DIRECTORY_STORE_NAME, 'readwrite');
    transaction.objectStore(DIRECTORY_STORE_NAME).put(handle, 'notes-directory');
    transaction.addEventListener('complete', resolve);
    transaction.addEventListener('error', () => reject(transaction.error));
  });
}

async function getStoredDirectoryHandle() {
  const database = await directoryDatabase;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DIRECTORY_STORE_NAME, 'readonly');
    const request = transaction.objectStore(DIRECTORY_STORE_NAME).get('notes-directory');
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

async function activateNotesFolder(handle, showMessage = false) {
  if (!(await verifyPermission(handle, true))) {
    throw new Error('Permiso de escritura denegado.');
  }
  state.directoryHandle = handle;
  elements.folderName.textContent = `${NOTES_DIRECTORY_NAME}/`;
  elements.folderStatus.classList.add('connected');
  elements.newNote.disabled = false;
  elements.newFolder.disabled = false;
  elements.newFolder.disabled = false;
  elements.save.disabled = false;
  elements.delete.disabled = false;
  elements.search.disabled = false;
  elements.openFolder.hidden = true;
  elements.welcomeOpen.hidden = true;
  await loadNotes();
  if (showMessage) showToast(`Usando la carpeta ${NOTES_DIRECTORY_NAME}/.`);
}

async function openNotesFolder() {
  if (!('showDirectoryPicker' in window)) {
    showToast('Tu navegador no permite acceder a carpetas locales. Usa Chrome o Edge.', true);
    return;
  }

  try {
    const storedHandle = await getStoredDirectoryHandle().catch(() => null);
    const pickerOptions = { id: NOTES_DIRECTORY_NAME, mode: 'readwrite' };
    if (storedHandle) pickerOptions.startIn = storedHandle;
    const selectedHandle = await window.showDirectoryPicker(pickerOptions);
    let handle = selectedHandle;
    if (selectedHandle.name !== NOTES_DIRECTORY_NAME) {
      try {
        handle = await selectedHandle.getDirectoryHandle(NOTES_DIRECTORY_NAME);
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
        showToast(`No existe ${NOTES_DIRECTORY_NAME}/. Elige ahora la carpeta donde guardar tus notas.`);
        handle = await window.showDirectoryPicker({ id: NOTES_DIRECTORY_NAME, mode: 'readwrite' });
      }
    }
    await activateNotesFolder(handle, true);
    await storeDirectoryHandle(handle);
  } catch (error) {
    if (error.name !== 'AbortError') {
      const message = error.name === 'NotFoundError'
        ? `Selecciona la carpeta del proyecto que contiene ${NOTES_DIRECTORY_NAME}/.`
        : error.message || 'No se pudo abrir la carpeta.';
      showToast(message, true);
    }
  }
}

function restoreNotesFolder() {
  getStoredDirectoryHandle()
    .then((handle) => {
      if (!handle) return null;
      return handle.queryPermission({ mode: 'readwrite' }).then((permission) => {
        if (permission === 'granted') return activateNotesFolder(handle);
        return null;
      });
    })
    .catch((error) => {
      console.warn(`No se pudo restaurar el acceso a ${NOTES_DIRECTORY_NAME}/.`, error);
    });
}

async function loadNotes() {
  if (!state.directoryHandle) return;
  const loadedNotes = [];

  try {
    await loadGroupColors();
    const folders = [];
    for await (const [name, handle] of state.directoryHandle.entries()) {
      if (handle.kind === 'file' && isJsonFile(name)) {
        loadedNotes.push(await createNoteEntry(state.directoryHandle, '', name, handle));
      } else if (handle.kind === 'directory') {
        folders.push({ name, directoryHandle: handle });
        await collectNotes(handle, name, loadedNotes);
      }
    }
    loadedNotes.sort(compareNotes);
    state.notes = loadedNotes;
    folders.sort((first, second) => first.name.localeCompare(second.name));
    state.folders = folders;
    if (state.currentNote) updateFolderSelect(state.currentNote.folder);
    renderNotes();
  } catch (error) {
    console.error('No se pudieron leer las notas de la carpeta.', error);
    showToast('No se pudieron leer las notas de la carpeta.', true);
  }
}

function noteKey(note) {
  return `${note.folder}/${note.name}`;
}

function compareNotes(first, second) {
  const folderComparison = first.folder.localeCompare(second.folder);
  if (folderComparison !== 0) return folderComparison;
  const firstOrder = state.noteOrder.indexOf(noteKey(first));
  const secondOrder = state.noteOrder.indexOf(noteKey(second));
  if (firstOrder !== -1 || secondOrder !== -1) {
    if (firstOrder === -1) return 1;
    if (secondOrder === -1) return -1;
    if (firstOrder !== secondOrder) return firstOrder - secondOrder;
  }
  return second.modified - first.modified || first.title.localeCompare(second.title);
}

function saveNoteOrder() {
  state.noteOrder = state.notes.map(noteKey);
  return saveGroupColors();
}

async function collectNotes(directoryHandle, folder, loadedNotes) {
  for await (const [name, handle] of directoryHandle.entries()) {
    if (handle.kind === 'file' && isJsonFile(name)) {
      loadedNotes.push(await createNoteEntry(directoryHandle, folder, name, handle));
    }
  }
}

async function createNoteEntry(directoryHandle, folder, name, handle) {
  let modified = 0;
  try {
    const file = await handle.getFile();
    modified = file.lastModified;
  } catch (error) {
    console.warn(`No se pudo leer la fecha de ${name}`, error);
  }
  return { name, folder, directoryHandle, title: noteTitleFromFileName(name), modified };
}

function renderNotes() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  const filteredNotes = state.notes.filter((note) => note.title.toLocaleLowerCase().includes(query));
  elements.notesList.replaceChildren();
  elements.notesCount.textContent = state.notes.length;
  elements.emptyNotes.classList.toggle('hidden', filteredNotes.length > 0);

  if (state.notes.length > 0 && filteredNotes.length === 0) {
    elements.emptyNotes.querySelector('p').textContent = 'No hay notas que coincidan.';
  } else if (state.notes.length === 0) {
    elements.emptyNotes.querySelector('p').textContent = 'Crea tu primera nota para empezar.';
  } else {
    elements.emptyNotes.querySelector('p').textContent = 'Abre una carpeta para ver tus notas.';
  }

  elements.notesList.append(createFolderLabel('General'));
  let currentFolder = '';
  let hasRenderedNotesGroup = false;
  filteredNotes.forEach((note) => {
    if (note.folder !== currentFolder) {
      if (hasRenderedNotesGroup) elements.notesList.append(createNoteDropZone(currentFolder));
      currentFolder = note.folder;
      if (currentFolder) {
        elements.notesList.append(createFolderLabel(currentFolder));
      }
      hasRenderedNotesGroup = true;
    }
    if (state.collapsedFolders.has(note.folder)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.draggable = true;
    button.className = `note-item${state.currentNote?.name === note.name && state.currentNote?.folder === note.folder ? ' active' : ''}`;
    button.style.setProperty('--group-color', state.groupColors[note.folder] || '#73777d');
    button.innerHTML = `<span class="note-item-title"></span><span class="note-item-date"></span>`;
    button.querySelector('.note-item-title').textContent = note.title;
    button.querySelector('.note-item-date').textContent = formatDate(note.modified);
    button.addEventListener('click', () => openNote(note));
    button.addEventListener('dragstart', (event) => {
      state.draggedNote = note;
      button.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', noteKey(note));
    });
    button.addEventListener('dragend', () => {
      state.draggedNote = null;
      button.classList.remove('dragging');
      document.querySelectorAll('.note-item, .note-group-label').forEach((element) => element.classList.remove('drag-over'));
    });
    button.addEventListener('dragover', (event) => {
      if (state.draggedNote?.folder !== note.folder || state.draggedNote === note) return;
      event.preventDefault();
      button.classList.add('drag-over');
    });
    button.addEventListener('dragleave', () => button.classList.remove('drag-over'));
    button.addEventListener('drop', async (event) => {
      event.preventDefault();
      button.classList.remove('drag-over');
      if (state.draggedNote?.folder === note.folder && state.draggedNote !== note) {
        await reorderNote(state.draggedNote, note);
      }
    });
    elements.notesList.append(button);
  });
  if (hasRenderedNotesGroup) elements.notesList.append(createNoteDropZone(currentFolder));

  state.folders
    .filter((folder) => !filteredNotes.some((note) => note.folder === folder.name))
    .forEach((folder) => elements.notesList.append(createFolderLabel(folder.name)));

  lucide.createIcons();
}

function createNoteDropZone(folderName) {
  const dropZone = document.createElement('div');
  dropZone.className = 'note-drop-zone';
  dropZone.dataset.folder = folderName;
  dropZone.style.setProperty('--group-color', state.groupColors[folderName] || '#73777d');
  dropZone.addEventListener('dragover', (event) => {
    if (state.draggedNote?.folder !== folderName) return;
    event.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', async (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
    if (state.draggedNote?.folder === folderName) {
      await moveNoteToEnd(state.draggedNote);
    }
  });
  return dropZone;
}

function createFolderLabel(folderName) {
  const groupLabel = document.createElement('div');
  const folderKey = folderName === 'General' ? '' : folderName;
  const isCollapsed = state.collapsedFolders.has(folderKey);
  const groupColor = state.groupColors[folderKey] || '#73777d';
  groupLabel.className = 'note-group-label';
  groupLabel.style.setProperty('--group-color', groupColor);
  groupLabel.tabIndex = 0;
  groupLabel.setAttribute('role', 'button');
  groupLabel.addEventListener('dragover', (event) => {
    if (!state.draggedNote || state.draggedNote.folder === folderKey) return;
    event.preventDefault();
    groupLabel.classList.add('drag-over');
  });
  groupLabel.addEventListener('dragleave', () => groupLabel.classList.remove('drag-over'));
  groupLabel.addEventListener('drop', async (event) => {
    event.preventDefault();
    groupLabel.classList.remove('drag-over');
    if (state.draggedNote && state.draggedNote.folder !== folderKey) {
      await moveNoteEntry(state.draggedNote, folderKey);
    }
  });
  groupLabel.setAttribute('aria-expanded', String(!isCollapsed));
  groupLabel.addEventListener('click', () => {
    if (state.collapsedFolders.has(folderKey)) state.collapsedFolders.delete(folderKey);
    else state.collapsedFolders.add(folderKey);
    renderNotes();
  });
  const folderNameElement = document.createElement('span');
  folderNameElement.className = 'folder-label-text';
  const collapseIcon = document.createElement('i');
  collapseIcon.dataset.lucide = isCollapsed ? 'chevron-right' : 'chevron-down';
  collapseIcon.setAttribute('aria-hidden', 'true');
  folderNameElement.append(collapseIcon, document.createTextNode(folderName));
  const groupActions = document.createElement('span');
  groupActions.className = 'group-actions';
  const menuButton = document.createElement('button');
  menuButton.className = 'folder-menu-button';
  menuButton.type = 'button';
  menuButton.title = `Acciones de ${folderName}`;
  menuButton.innerHTML = '<i data-lucide="more-horizontal" aria-hidden="true"></i>';
  const groupMenu = document.createElement('div');
  groupMenu.className = 'folder-menu';
  groupMenu.hidden = true;
  const newNoteButton = document.createElement('button');
  newNoteButton.className = 'folder-menu-item';
  newNoteButton.type = 'button';
  newNoteButton.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i><span>Nueva nota</span>';
  newNoteButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const folder = folderName === 'General'
      ? { directoryHandle: state.directoryHandle, name: '' }
      : state.folders.find((item) => item.name === folderName);
    if (folder) createNewNote(folder.directoryHandle, folder.name);
    groupMenu.hidden = true;
  });
  const colorButton = document.createElement('button');
  colorButton.className = 'folder-menu-item';
  colorButton.type = 'button';
  colorButton.innerHTML = '<i data-lucide="palette" aria-hidden="true"></i><span>Cambiar color</span>';
  const colorPalette = document.createElement('span');
  colorPalette.className = 'group-color-palette';
  colorPalette.hidden = true;
  GROUP_COLORS.forEach((color) => {
    const swatch = document.createElement('button');
    swatch.className = 'group-color-swatch';
    swatch.type = 'button';
    swatch.title = color;
    swatch.style.backgroundColor = color;
    swatch.addEventListener('click', async (event) => {
      event.stopPropagation();
      state.groupColors[folderKey] = color;
      colorPalette.hidden = true;
      try {
        await saveGroupColors();
        renderNotes();
      } catch (error) {
        console.error('No se pudo guardar el color del grupo.', error);
        showToast('No se pudo guardar el color del grupo.', true);
      }
    });
    colorPalette.append(swatch);
  });
  colorButton.addEventListener('click', (event) => {
    event.stopPropagation();
    colorPalette.hidden = !colorPalette.hidden;
  });
  const deleteFolderButton = document.createElement('button');
  deleteFolderButton.className = 'folder-menu-item folder-menu-danger';
  deleteFolderButton.type = 'button';
  deleteFolderButton.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i><span>Eliminar grupo</span>';
  deleteFolderButton.disabled = folderName === 'General';
  deleteFolderButton.addEventListener('click', (event) => {
    event.stopPropagation();
    deleteFolder(folderName);
    groupMenu.hidden = true;
  });
  groupMenu.addEventListener('click', (event) => event.stopPropagation());
  groupMenu.append(newNoteButton, colorButton, colorPalette, deleteFolderButton);
  menuButton.addEventListener('click', (event) => {
    event.stopPropagation();
    groupMenu.hidden = !groupMenu.hidden;
  });
  groupLabel.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      groupLabel.click();
    }
  });
  groupActions.append(menuButton);
  groupLabel.append(folderNameElement, groupActions, groupMenu);
  return groupLabel;
}

function updateFolderSelect(selectedFolder = '') {
  elements.folderSelect.replaceChildren();
  const generalOption = document.createElement('option');
  generalOption.value = '';
  generalOption.textContent = 'General';
  elements.folderSelect.append(generalOption);
  state.folders.forEach((folder) => {
    const option = document.createElement('option');
    option.value = folder.name;
    option.textContent = folder.name;
    elements.folderSelect.append(option);
  });
  elements.folderSelect.value = selectedFolder;
}

async function readNote(noteEntry) {
  const fileHandle = await noteEntry.directoryHandle.getFileHandle(noteEntry.name);
  const file = await fileHandle.getFile();
  const content = await file.text();
  const note = JSON.parse(content);
  return { fileHandle, note };
}

async function openNote(noteEntry) {
  try {
    const { fileHandle, note } = await readNote(noteEntry);
    state.currentNote = { name: noteEntry.name, folder: noteEntry.folder, directoryHandle: noteEntry.directoryHandle, fileHandle, note };
    elements.title.value = note.title || noteTitleFromFileName(noteEntry.name);
    updateFolderSelect(noteEntry.folder);
    quill.setContents(note.content || { ops: [] });
    elements.welcomeView.classList.add('hidden');
    elements.noteView.classList.remove('hidden');
    elements.currentNoteLabel.textContent = noteEntry.folder ? `${noteEntry.folder}/${noteEntry.name}` : noteEntry.name;
    elements.save.disabled = false;
    elements.delete.disabled = false;
    state.isDirty = false;
    setSaveStatus('Guardado');
    renderNotes();
  } catch (error) {
    console.error(`No se pudo abrir la nota ${noteEntry.name}.`, error);
    showToast('La nota no tiene un formato válido o no se pudo abrir.', true);
  }
}

async function createNewNote(directoryHandle = state.directoryHandle, folder = '') {
  if (!state.directoryHandle) return;
  const now = Date.now();
  const baseTitle = 'Nota sin título';
  const fileName = `${sanitizeFileName(baseTitle)}-${now}.json`;
  const initialNote = {
    version: 1,
    title: baseTitle,
    content: { ops: [] },
    createdAt: now,
    updatedAt: now,
  };

  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
    state.currentNote = { name: fileName, folder, directoryHandle, fileHandle, note: initialNote };
    await writeCurrentNote();
    elements.title.value = baseTitle;
    updateFolderSelect(folder);
    quill.setContents(initialNote.content);
    elements.welcomeView.classList.add('hidden');
    elements.noteView.classList.remove('hidden');
    elements.currentNoteLabel.textContent = folder ? `${folder}/${fileName}` : fileName;
    state.isDirty = false;
    renderNotes();
    elements.title.focus();
    elements.title.select();
  } catch (error) {
    console.error('No se pudo crear la nota.', error);
    showToast('No se pudo crear la nota.', true);
  }
}

async function createNoteFromWelcome() {
  if (!state.directoryHandle) await openNotesFolder();
  if (state.directoryHandle) await createNewNote();
}

async function createNewFolder() {
  if (!state.directoryHandle) return;
  const requestedName = window.prompt('Nombre de la nueva sección:');
  if (!requestedName?.trim()) return;
  const folderName = sanitizeFileName(requestedName);

  try {
    await state.directoryHandle.getDirectoryHandle(folderName, { create: true });
    await loadNotes();
    showToast(`Sección ${folderName} creada.`);
  } catch (error) {
    console.error('No se pudo crear la sección.', error);
    showToast('No se pudo crear la sección.', true);
  }
}

async function deleteFolder(folderName) {
  if (!state.directoryHandle || folderName === 'General') return;
  if (!state.folders.some((item) => item.name === folderName)) return;
  if (state.notes.some((note) => note.folder === folderName)) {
    showToast('Mueve o elimina primero las notas de este grupo.', true);
    return;
  }
  if (!window.confirm(`¿Eliminar el grupo "${folderName}"?`)) return;

  try {
    await state.directoryHandle.removeEntry(folderName);
    delete state.groupColors[folderName];
    await saveGroupColors();
    await loadNotes();
    showToast(`Grupo ${folderName} eliminado.`);
  } catch (error) {
    console.error('No se pudo eliminar el grupo.', error);
    showToast('No se pudo eliminar el grupo.', true);
  }
}

async function reorderNote(draggedNote, targetNote) {
  const notesInGroup = state.notes.filter((note) => note.folder === draggedNote.folder && note !== draggedNote);
  const targetIndex = notesInGroup.indexOf(targetNote);
  if (targetIndex === -1) return;
  notesInGroup.splice(targetIndex, 0, draggedNote);
  let groupIndex = 0;
  state.notes = state.notes.map((note) => {
    if (note.folder !== draggedNote.folder) return note;
    return notesInGroup[groupIndex++];
  });
  await saveNoteOrder();
  renderNotes();
}

async function moveNoteToEnd(draggedNote) {
  const notesInGroup = state.notes.filter((note) => note.folder === draggedNote.folder && note !== draggedNote);
  notesInGroup.push(draggedNote);
  let groupIndex = 0;
  state.notes = state.notes.map((note) => {
    if (note.folder !== draggedNote.folder) return note;
    return notesInGroup[groupIndex++];
  });
  await saveNoteOrder();
  renderNotes();
}

async function moveNoteEntry(noteEntry, targetFolder) {
  if (!state.directoryHandle || targetFolder === noteEntry.folder) return;
  if (state.currentNote?.name === noteEntry.name && state.currentNote?.folder === noteEntry.folder && state.isDirty) {
    await saveCurrentNote();
  }
  const target = targetFolder
    ? state.folders.find((folder) => folder.name === targetFolder)
    : { directoryHandle: state.directoryHandle, name: '' };
  if (!target) throw new Error('El grupo de destino no existe.');

  const { note } = await readNote(noteEntry);
  const targetName = await getAvailableFileName(note.title || noteTitleFromFileName(noteEntry.name), '', target.directoryHandle);
  const targetHandle = await target.directoryHandle.getFileHandle(targetName, { create: true });
  setSaveStatus('Moviendo...', 'saving');
  await writeFile(targetHandle, note);
  await noteEntry.directoryHandle.removeEntry(noteEntry.name);

  if (state.currentNote?.name === noteEntry.name && state.currentNote?.folder === noteEntry.folder) {
    state.currentNote = { name: targetName, folder: targetFolder, directoryHandle: target.directoryHandle, fileHandle: targetHandle, note };
    elements.currentNoteLabel.textContent = targetFolder ? `${targetFolder}/${targetName}` : targetName;
    updateFolderSelect(targetFolder);
  }
  state.noteOrder = state.noteOrder.filter((key) => key !== noteKey(noteEntry));
  await loadNotes();
  await saveNoteOrder();
  setSaveStatus('Guardado ahora');
  showToast(`Nota movida a ${targetFolder || 'General'}.`);
}

async function moveCurrentNote(event) {
  if (!state.currentNote || !state.directoryHandle) return;
  const targetFolder = event.target.value;
  if (targetFolder === state.currentNote.folder) return;

  try {
    if (!(await verifyPermission(state.directoryHandle, true))) {
      throw new Error('El permiso para mover la nota fue denegado.');
    }
    await moveNoteEntry(state.currentNote, targetFolder);
    state.isDirty = false;
  } catch (error) {
    elements.folderSelect.value = state.currentNote.folder;
    console.error('No se pudo cambiar el grupo de la nota.', error);
    showToast(error.message || 'No se pudo cambiar el grupo.', true);
  }
}

async function deleteCurrentNote() {
  if (!state.currentNote || !state.directoryHandle) return;
  const noteLabel = state.currentNote.folder
    ? `${state.currentNote.folder}/${state.currentNote.name}`
    : state.currentNote.name;
  if (!window.confirm(`¿Eliminar la nota "${noteLabel}"? Esta acción no se puede deshacer.`)) return;

  try {
    if (!(await verifyPermission(state.directoryHandle, true))) {
      throw new Error('El permiso para borrar la nota fue denegado.');
    }
    await state.currentNote.directoryHandle.removeEntry(state.currentNote.name);
    state.currentNote = null;
    state.isDirty = false;
    elements.title.value = '';
    quill.setContents({ ops: [] });
    elements.noteView.classList.add('hidden');
    elements.welcomeView.classList.remove('hidden');
    elements.currentNoteLabel.textContent = 'Sin nota seleccionada';
    elements.save.disabled = true;
    elements.delete.disabled = true;
    setSaveStatus('Listo');
    await loadNotes();
    showToast('Nota eliminada.');
  } catch (error) {
    console.error('No se pudo eliminar la nota.', error);
    showToast(error.message || 'No se pudo eliminar la nota.', true);
  }
}

async function writeFile(fileHandle, note) {
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(`${JSON.stringify(note, null, 2)}\n`);
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}

async function loadGroupColors() {
  try {
    const configHandle = await state.directoryHandle.getFileHandle(GROUP_CONFIG_FILE, { create: true });
    const configFile = await configHandle.getFile();
    const configText = await configFile.text();
    const config = configText.trim() ? JSON.parse(configText) : {};
    state.groupColors = config.groupColors || {};
    state.noteOrder = Array.isArray(config.noteOrder) ? config.noteOrder : [];
  } catch (error) {
    state.groupColors = {};
    console.warn('No se pudo cargar la configuración de colores.', error);
  }
}

async function saveGroupColors() {
  const configHandle = await state.directoryHandle.getFileHandle(GROUP_CONFIG_FILE, { create: true });
  await writeFile(configHandle, { version: 1, groupColors: state.groupColors, noteOrder: state.noteOrder });
}

async function getAvailableFileName(title, currentName, directoryHandle) {
  const baseName = `${sanitizeFileName(title)}`;
  let candidate = `${baseName}.json`;
  let suffix = 2;

  while (candidate !== currentName) {
    try {
      await directoryHandle.getFileHandle(candidate);
      candidate = `${baseName} (${suffix}).json`;
      suffix += 1;
    } catch (error) {
      if (error.name === 'NotFoundError') return candidate;
      throw error;
    }
  }

  return candidate;
}

async function writeCurrentNote() {
  if (!state.currentNote || !state.directoryHandle) return;
  const title = elements.title.value.trim() || 'Nota sin título';
  const content = quill.getContents();
  const previousName = state.currentNote.name;
  const noteDirectory = state.currentNote.directoryHandle;
  const desiredName = await getAvailableFileName(title, previousName, noteDirectory);
  const note = {
    version: 1,
    title,
    content,
    createdAt: state.currentNote.note.createdAt || Date.now(),
    updatedAt: Date.now(),
  };

  setSaveStatus('Guardando...', 'saving');
  state.currentNote.note = note;
  await writeFile(state.currentNote.fileHandle, note);

  if (desiredName !== previousName) {
    const targetHandle = await noteDirectory.getFileHandle(desiredName, { create: true });
    await writeFile(targetHandle, note);
    await noteDirectory.removeEntry(previousName);
    state.currentNote.name = desiredName;
    state.currentNote.fileHandle = targetHandle;
    elements.currentNoteLabel.textContent = desiredName;
    const previousKey = `${state.currentNote.folder}/${previousName}`;
    const renamedKey = `${state.currentNote.folder}/${desiredName}`;
    state.noteOrder = state.noteOrder.map((key) => key === previousKey ? renamedKey : key);
  }

  state.isDirty = false;
  setSaveStatus('Guardado ahora');
  await loadNotes();
  await saveNoteOrder();
}

function scheduleSave() {
  state.isDirty = true;
  setSaveStatus('Cambios sin guardar');
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(() => {
    saveCurrentNote().catch((error) => {
      setSaveStatus('Error al guardar', 'error');
      showToast(error.message || 'No se pudo guardar la nota.', true);
    });
  }, 900);
}

async function saveCurrentNote() {
  if (!state.currentNote || !state.directoryHandle || !state.isDirty) return;
  if (!(await verifyPermission(state.directoryHandle, true))) {
    throw new Error('El permiso para escribir en la carpeta fue denegado.');
  }
  await writeCurrentNote();
}

function handleImagePaste(event) {
  const clipboardItems = Array.from(event.clipboardData?.items || []);
  const imageItem = clipboardItems.find((item) => item.type.startsWith('image/'));
  if (!imageItem) return;

  event.preventDefault();
  const imageFile = imageItem.getAsFile();
  if (!imageFile) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const range = quill.getSelection(true) || { index: quill.getLength(), length: 0 };
    quill.insertEmbed(range.index, 'image', reader.result, 'user');
    quill.setSelection(range.index + 1, 0, 'silent');
    scheduleSave();
  });
  reader.readAsDataURL(imageFile);
}

function handleTitleChange() {
  scheduleSave();
}

elements.openFolder.addEventListener('click', openNotesFolder);
elements.welcomeOpen.addEventListener('click', createNoteFromWelcome);
elements.newNote.addEventListener('click', createNewNote);
elements.newFolder.addEventListener('click', createNewFolder);
elements.folderSelect.addEventListener('change', moveCurrentNote);
elements.delete.addEventListener('click', deleteCurrentNote);
elements.save.addEventListener('click', () => {
  saveCurrentNote().catch((error) => {
    setSaveStatus('Error al guardar', 'error');
    showToast(error.message || 'No se pudo guardar la nota.', true);
  });
});
elements.search.addEventListener('input', renderNotes);
elements.title.addEventListener('input', handleTitleChange);
quill.on('text-change', (change, oldChange, source) => {
  if (source === 'user') scheduleSave();
});
quill.root.addEventListener('paste', handleImagePaste);
lucide.createIcons();
restoreNotesFolder();

window.addEventListener('beforeunload', (event) => {
  if (state.isDirty) {
    event.preventDefault();
  }
});
