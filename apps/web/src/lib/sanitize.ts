import DOMPurify from 'dompurify';

export function sanitizeHtml(dirty: string): string {
  if (!dirty) return '';
  return DOMPurify.sanitize(dirty, { ALLOWED_TAGS: ['b','i','em','strong','a','p','br','ul','ol','li','code','pre','h1','h2','h3','h4','h5','h6','blockquote','table','thead','tbody','tr','th','td','hr','img','input','del','span','div'], ALLOWED_ATTR: ['href','src','alt','title','checked','disabled','type','class','style','width','height','data-label','data-list-type','data-spread'] });
}
