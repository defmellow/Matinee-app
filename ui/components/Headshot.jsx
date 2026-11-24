// A person's photo (TMDB profile path) with a neutral initials tile underneath, so the space is the same with or without a photo and nothing jumps.
// The size comes from the class the caller gives it (cast rows, hover card, person page). Photos load lazily and fade in.
import { useEffect, useRef, useState } from 'preact/hooks';
import { imageUrl } from '../api.js';
import { photoUrl, initials } from './personpop.js';
import './personpop.css';

export default function Headshot({ photo, name, size = 'w185', class: cls = '', lazy = true }) {
  const src = photoUrl(photo, size);
  const [state, setState] = useState('idle'); // idle -> loaded | failed
  const img = useRef(null);
  useEffect(() => { setState('idle'); if (img.current && img.current.complete && img.current.naturalWidth) setState('loaded'); }, [src]);
  return (
    <span class={`hs ${cls}`} aria-hidden="true">
      <span class="hs-i">{initials(name)}</span>
      {src && state !== 'failed' && (
        <img ref={img} class={state === 'loaded' ? 'hs-img hs-on' : 'hs-img'} src={imageUrl(src)} alt="" loading={lazy ? 'lazy' : 'eager'} decoding="async" draggable={false}
          onLoad={() => setState('loaded')} onError={() => setState('failed')} />
      )}
    </span>
  );
}
