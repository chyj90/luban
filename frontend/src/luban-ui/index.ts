// LubanUI 入口 — 构建注入 iframe 的 CSS / JS 字符串
import themeCSS from './theme.css?raw';
import tableCSS from './components/table.css?raw';
import buttonCSS from './components/button.css?raw';
import formCSS from './components/form.css?raw';
import inputCSS from './components/input.css?raw';
import textareaCSS from './components/textarea.css?raw';
import selectCSS from './components/select.css?raw';
import inputNumberCSS from './components/input-number.css?raw';
import datepickerCSS from './components/datepicker.css?raw';
import checkboxCSS from './components/checkbox.css?raw';
import radioCSS from './components/radio.css?raw';
import switchCSS from './components/switch.css?raw';
import statsCSS from './components/stats.css?raw';
import cardCSS from './components/card.css?raw';
import modalCSS from './components/modal.css?raw';
import paginationCSS from './components/pagination.css?raw';
import tabsCSS from './components/tabs.css?raw';
import badgeCSS from './components/badge.css?raw';
import chartCSS from './components/chart.css?raw';
import filterBarCSS from './components/filter-bar.css?raw';
import toastCSS from './components/toast.css?raw';
import emptyCSS from './components/empty.css?raw';
import loadingCSS from './components/loading.css?raw';
import pageHeaderCSS from './components/page-header.css?raw';
import showcaseCSS from './showcase.css?raw';

import tableJS from './components/table.js?raw';
import modalJS from './components/modal.js?raw';
import toastJS from './components/toast.js?raw';
import selectJS from './components/select.js?raw';
import pageHeaderJS from './components/page-header.js?raw';
import lubanUIJS from './LubanUI.js?raw';

import echartsSource from 'echarts/dist/echarts.min.js?raw';

export const LUBAN_UI_CSS = [
  themeCSS,
  tableCSS,
  buttonCSS,
  formCSS,
  inputCSS,
  textareaCSS,
  selectCSS,
  inputNumberCSS,
  datepickerCSS,
  checkboxCSS,
  radioCSS,
  switchCSS,
  statsCSS,
  cardCSS,
  modalCSS,
  paginationCSS,
  tabsCSS,
  badgeCSS,
  chartCSS,
  filterBarCSS,
  toastCSS,
  emptyCSS,
  loadingCSS,
  pageHeaderCSS,
  showcaseCSS,
].join('\n');

export const LUBAN_UI_JS = [
  tableJS,
  modalJS,
  toastJS,
  selectJS,
  pageHeaderJS,
  lubanUIJS,
].join('\n');

export const ECHARTS_SOURCE = echartsSource;