'use client';
import { useEffect, useRef } from 'react';
import { useLanguage } from '@/lib/i18n';

const cache = new Map<string, string>();
export function GoogleCloudTranslateContent() {
  const { language, setTranslationUnavailable } = useLanguage();
  const originals = useRef(new WeakMap<Text, string>());
  useEffect(() => {
    const root = document.querySelector('.content');
    if (!root) return;
    const targetLanguage = language === 'pt' ? 'pt-BR' : language;
    const translate = async () => {
      const nodes: Text[] = []; const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text; const parent = text.parentElement; const original = originals.current.get(text) ?? text.nodeValue ?? '';
        if (!parent || parent.closest('script,style,noscript,svg,code,pre,input,textarea,select,option,[translate="no"],[data-translation-ignore]') || original.trim().length < 3 || /^[\p{N}\p{P}\p{S}\s]+$/u.test(original.trim()) || /^[A-Z][A-Z0-9.-]{0,9}$/.test(original.trim())) continue;
        originals.current.set(text, original); nodes.push(text);
      }
      if (language === 'en') { nodes.forEach((node) => { node.nodeValue = originals.current.get(node)!; }); return; }
      const unique = [...new Set(nodes.map((node) => originals.current.get(node)!))];
      const missing = unique.filter((text) => !cache.has(`${targetLanguage}\u0000${text}`));
      try {
        for (let i = 0; i < missing.length; i += 100) { const texts = missing.slice(i, i + 100); const response = await fetch('/api/translation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetLanguage, texts }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); result.translations.forEach((item: { translatedText: string }, index: number) => cache.set(`${targetLanguage}\u0000${texts[index]}`, item.translatedText)); }
        nodes.forEach((node) => { node.nodeValue = cache.get(`${targetLanguage}\u0000${originals.current.get(node)!}`) ?? node.nodeValue; }); setTranslationUnavailable(false);
      } catch { setTranslationUnavailable(true); }
    };
    void translate();
  }, [language, setTranslationUnavailable]);
  return null;
}
