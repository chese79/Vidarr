import {expect,it} from 'vitest';
import {genreFilterOptions} from '../src/genreOptions';
import type {GenreStats} from '@vidarr/shared-types';

it('shares broad parents and exact canonical labels without an artificial Other genre',()=>{
  const stats={genres:[{name:'electronic',isOther:false,subgenres:[{name:'trip hop'},{name:'house'}]},{name:'other',isOther:true,subgenres:[{name:'custom sound'}]}]} as GenreStats;
  expect(genreFilterOptions(stats,[{genre:'stale label'}])).toEqual(['custom sound','electronic','house','trip hop']);
});
it('retains legacy choices while statistics are unavailable without rewriting them',()=>{
  expect(genreFilterOptions(undefined,[{genre:'Rock, shoegaze'},{genre:'Rock'}])).toEqual(['Rock','shoegaze']);
});
