/*
 * UTF-8 Mappings
 * μ  : U+03bc
 * ᐅᶠ : U+1405 U+1da0
 */

/*
 * Missing
 *
 *
 * other
 *  px/unpx
 *  wait
 *  attr
 *  relative_xy
 *  immutable
 *  Some
 *  defined
 *
 */

/*
 * Obvious TODOs
 *
 * mutative alternatives for more APIs
 *   - not everything has a logical mutable alternative
 *   - for example, id
 * tests for
 *   - d (descriptor factory)
 *   - internal APIs (mutative)
 *   - define_prop.mut, define_props.mut
 * less awful lenses
 *   - lens, today, is largely useless
 *   - involves a ton of boilerplate
 *   - doesn't interoperate as neatly as i'd hoped with insert/update APIs
 * μ.time.wait, μ.time.every, μ.time.asap
 *   - wait  ⇔ setTimeout
 *   - every ⇔ setInterval
 *   - asap  ⇔ requestAnimationFrame
 */
import d from './d'
import { define_prop, define_props, define, with_mutative, derive_from } from './mutton'
import { own_descs, get_desc as unsafe_get_desc, of_properties, bind, symbol_keys, string_keys, keys } from './lynchpin'
import { source, code } from './fungible'

export {
  d, define_prop, define_props, define,
  // FIXME: of_properties shouldn't need to be renamed
  of_properties, bind,
}

// FIXME: remove
export const block = f => call(f)()

// functions
export const id      = v  => v
export const on      = v  => fold(f => prev => (prev !== None ? f(prev) : f)(v))(None)
export const ret     = v  =>    _ => v
export const call    = f  =>    v => f(v)
export const pass    = v  =>    f => f(v)
export const loop    = n  =>    f => { let i = n; while (i--) { f(i) } }
export const apply   = f  => args => fold(pass)(f)(args)
export const and     = fs =>    v => all(pass(v))(fs)
export const or      = fs =>    v => any(pass(v))(fs)
export const fmap    = fs =>    v => map(pass(v))(fs)
export const flip    = f  =>    a => b => f(b)(a)
export const compose = f  =>    g => v => g(f(v))
export const times   = n  =>    f => v => fold(call)(v)(n_of(f)(n))
const _mimic_fn_meta = f => of_properties({
  name     : d.iter_only({ g: _ => f.name }),
  toString : d.nothing({ v: _ => f.toString() }),
})
export const meta_fn  = with_mutative(define.mut)(meta => ᐅᶠ([ copy_fn, meta_fn.mut(meta) ]))
export const mimic_fn = derive_from(meta_fn)(meta_fn => target => meta_fn(_mimic_fn_meta(target)))
// constructing functions from strings (for rotten profit)
export const named     = name => def => code.iife(source.let(name)(def.toString()))
export const copy_fn   = f    => bind({})(f)

/* =================
 * Copying Functions
 * =================
 *
 * there are 4 pieces of state to keep in mind when copying functions.
 *
 * 1. closure (lexical) state
 * 2. identity (own) state
 * 3. instance (prototypal) state
 * 4. contextual (this) state
 *
 * if a copy loses the lexical environment of its closure, undefined errors are going to be
 * introduced when the copy tries to access a member of its (now empty) scope. pure functions are
 * immune to this.
 *
 * ```
 * // example:
 * function monotonic_incrementer () {
 *   let value = 0
 *   return function increment () {
 *     return ++value
 *   }
 * }
 *
 * let next = monotonic_incrementer()
 * let copy_next = copy(next)
 * next()      // ⇒ 1
 * copy_next() // ⇒ ++value ⇒ ++undefined ⇒ NaN
 * ```
 *
 * if a copy loses identity state (that is, if `name`, `toString()`, other implicit properties set
 * by the runtime during function definition change), introspection is crippled, and any form of
 * copy-to-source comparison (not just direct equality comparison) becomes nigh impossible.
 *
 * ```
 * // example:
 * function debug_log_function (f) {
 *   console.log(`${f.name}: ${f.toString()}`)
 * }
 * function add (a, b) { return a + b }
 * debug_log_function(add)       // ⇒ logs: "add: function add (a, b) { return a + b }"
 * debug_log_function(copy(add)) // unknown behavior (implementation and js engine specific)
 * ```
 *
 * if a copy loses instance state (the prototype changes), its inheritance chain is broken, and
 * instanceof checks that should succeed will fail.
 *
 * ```
 * // example:
 * class Rect () {
 *   constructor (length, height) {
 *     this.length = length
 *     this.height = height
 *   }
 *   area () {
 *     return this.length * this.height
 *   }
 * }
 *
 * let size5_square = new Rect(5, 5)
 * size5_square.area()                // ⇒ 25
 * size5_square instanceof Rect       // ⇒ true
 * copy(size5_square) instanceof Rect // ⇒ false
 * copy(size5_square).area()          // ⇒ TypeError: undefined is not a function
 * ```
 *
 * if a copy loses contextual state (that is, if it is bound to a context using bind() and can no
 * longer be implicitly rebound to a new context), it is no longer usable as, for example, a mixin
 * definition for an object, because its `this` value will not change when its runtime context
 * changes.
 *
 * ```
 * // example:
 * function debug_mixin () {
 *   return {
 *     type  : typeof this,
 *     proto : Object.getPrototypeOf(this),
 *     value : this.valueOf(),
 *   }
 * }
 *
 * const debuggable_C = Object.create(class C { }, {
 *   debug: { value: debug_mixin }
 * })
 * debuggable_C.debug() // ⇒ { type: "object", proto: C.prototype, valueOf: Function {...} }
 *
 * const not_so_debuggable_C = Object.create(class C { }, {
 *   debug: { value: copy(debug_mixin) }
 * })
 * not_so_debuggable_C.debug() // ⇒ { type: "object", proto: Object.prototype, valueOf: {} }
 * ```
 *
 * there is no elegant method of copying functions that can avoid every pitfall.
 *
 * here are known methods for copying functions, and trade-offs they introduce:
 *
 * 1. create a wrapper function (not truly a copy, but a 'mimic') that calls the source function
 *    - preserves closure state
 *    - loses identity state (but this can be mitigated, at least partly, by copying it separately)
 *    - loses instance state (this can probably be mitigated by directly setting prototype)
 *    - loses contextual state (unless it binds the inner function to its own context)
 *    - complex: all non-closure state must be manually copied
 *    - flexible: permits arbitrary pre- and post-call code execution (separate use-case)
 * 2. (new Function(`return ${source_function.toString()}`))()
 *    - loses closure state (and there's no way to access a closure's lexical state to copy it)
 *    - preserves identity state (cleanly; it evaluates a 2nd definition of the original function)
 *    - loses instance state (can be mitigated by directly setting prototype)
 *    - preserves contextual state (the function is not rebound or moved into a new scope)
 *    - simple: preserves most of a function's state without manual copying
 *    - inefficient: evaluates a source string, triggering a parse/compile sequence in the runtime
 *    - problem: there's no way to copy the lexical environment of the original closure
 * 3. rebind the function to a new (empty) context
 *    - preserves closure state
 *    - loses identity state (but this can be mitigated at least partly)
 *    - preserves instance state (afaict)
 *    - loses contextual state (only an explicit rebind can change the copy's context)
 *    - problem: there's no way to restore normal contextual state behavior to the copy
 *
 * if lexical state and copy efficiency are unimportant, method 2 is superior. if lexical state is
 * important, only methods 1 and 3 are applicable. of the two, method 1 is more hacky, more complex,
 * and yet generally superior, because it is able to preserve the most state. method 3 clobbers
 * contextual state, with no way to restore normal runtime contextual state behavior. if it is known
 * that runtime contextual state behavior is unimportant, then method 3 is acceptable; however, it
 * is only a side effect of function rebinding that the source function is 'copied,' not the intent
 * of function rebinding. while it can generally be relied upon that function rebinding will cause
 * the javascript engine to replicate the source function's behavior (including lexical state), it
 * is purposefully designed to *replace* contextual state, and that's all it has to do.
 *
 * the best method for copying a function is to re-evaluate its definition, then copy the lexical
 * environment from its source. unfortunately, we cannot access the lexical environment of a closure
 * in javascript. mimicking a function (method 1) is not quite the same, and rebinding a function
 * (method 3) is a different operation that happens to copy a function as a byproduct. method 2,
 * which does re-evaluate the function definition, cannot be adapted to copy the source function's
 * lexical environment, making it suitable only for copying pure functions.
 *
 * also worth considering: native runtime functions (whose source is not introspectable, due to its
 * likely not being expressible in javascript in the first place) and/or node-gyp style
 * foreign-functions cannot be copied using function re-evaluation, because the source is not
 * available. but this begs the question: when and why are you copying non-user functions that are
 * not part of your codebase in the first place? why would you copy, for example, Math.cos? or a
 * function from an external library? it should never be seen as acceptable practice to mutate the
 * standard library, or anyone's library for that matter, when extending them.
 *
 * so we are at an impasse. if we were going to expose a single API for copying functions, which
 * trade-offs should it choose?
 */

// numbers
export const inc = x => x + 1
export const dec = x => x - 1
// NOTE(jordan): without defaulting v to 0: num() ⇒ +undefined ⇒ NaN, which we don't want
export const num = (v=0) => +v

// arrays
export const map     = f => arr => []      .map.call(arr, f)
export const find    = f => arr => []     .find.call(arr, f) || None
export const join    = v => arr => []     .join.call(arr, v)
export const any     = f => arr => []     .some.call(arr, f)
export const sort    = f => arr => []     .sort.call(arr, f) // NOTE: in-place! like reverse
export const all     = f => arr => []    .every.call(arr, f)
export const concat  = a =>   b => []   .concat.call([], a, b)
export const filter  = f => arr => []   .filter.call(arr, f)
export const each    = f => arr => ([] .forEach.call(arr, f), arr) // NOTE: could mutate...
export const index   = v => arr => []  .indexOf.call(arr, v)
export const incl    = v => arr => [] .includes.call(arr, v)
export const findex  = f => arr => [].findIndex.call(arr, f)
export const slice   = i => j => arr => (instance(Array)(arr) ? [] : "").slice.call(arr, i, j)
export const fold    = f => init => arr => [].reduce.call(arr, (acc, v) => f(v)(acc), init)
export const len     = a => a.length
export const n_of    = x => n => (new Array(n)).fill(x)
export const cons    = v => concat([ v ])
export const push    = v => flip(concat)([ v ])
export const flatten = a => fold(flip(concat))([])(a)
export const flatmap = f => arr => flatten(map(f)(arr))
export const mapix   = f => map((it, ix) => f(ix)(it))
export const array_copy = arr => fold(define_property_pair)([])(properties(arr))
const _reverse = a => [].reverse.call(a)
const _splice  = i => n => vs => arr => ([].splice.apply(arr, concat([ i, n ])(vs||[])), arr)
const _til     = n => a => (loop(n)(i => a[i] = i), a)
export const reverse  = a => ᐅᶠ([ array_copy, _reverse ])(a)
export const til      = n => ᐅᶠ([ n_of(0), _til(n) ])(n)
export const thru     = n => til(inc(n))
export const splice   = with_mutative(_splice)(i => n => vs => ᐅᶠ([ array_copy, _splice(i)(n)(vs) ]))
export const take     = j => slice(0)(j)
export const skip     = i => arr => on(arr)([ len, slice(i) ])
export const rest     = a => skip(1)(a)
export const last     = a => ᐅᶠ([ skip(-1), ᐅif(a => len(a) === 0)(ret(None))(first) ])(a)
export const split_at = n => fmap([ take(n), skip(n) ])
export const split_on = v => arr => on(arr)([ index(v), split_at ])

// NOTE(jordan): generalized copy for non-Object object instances
// export const copy_instance = C => c => fold(define_property_pair)(new C)(properties(c))
// export const copy_array  = copy_instance(Array)

const splicer = derive_from(splice)
export const insert = splicer(splice => v => i => splice(i)(0)(v))
export const remdex = splicer(splice => i => splice(i)(1)())

// objects & arrays
// NOTE(jordan): `has(...)` is shallow; `in` or Reflect.has would be deep (proto traversing)
export const has      = prop  => obj => Object.hasOwnProperty.call(obj, prop)
export const get      = prop  => obj => has(prop)(obj) ? obj[prop] : None
export const get_all  = props => fmap(map(get)(props))

// objects
export const empty_object    = _   => of_properties({})
export const get_descriptor  = key => obj => ᐅif(has(key))(unsafe_get_desc(key))(_ => None)(obj)
export const pair_getter     = get => key => obj => [ key, get(key)(obj) ]
export const get_entry       = key => pair_getter(get)(key)
export const get_property    = key => pair_getter(get_descriptor)(key)
export const pairs_getter    = get => keys => obj => map(key => get(key)(obj))(keys)
export const get_entries     = keys => pairs_getter(get_entry)(keys)
export const get_properties  = keys => pairs_getter(get_property)(keys)
export const string_keyed_values     = obj => on(obj)([ string_keys, get_all ])
export const symbol_keyed_values     = obj => on(obj)([ symbol_keys, get_all ])
export const string_keyed_entries    = obj => on(obj)([ string_keys, get_entries ])
export const symbol_keyed_entries    = obj => on(obj)([ symbol_keys, get_entries ])
export const string_keyed_properties = obj => on(obj)([ string_keys, get_properties ])
export const symbol_keyed_properties = obj => on(obj)([ symbol_keys, get_properties ])
export const define_property_pair = ([ key, descriptor ]) => define_prop.mut(key)(descriptor)
export const define_entry_pair = ([ key, value ]) => define_prop.mut(key)(d.default({ v: value }))
export const get_both    = g_a => g_b => obj => ᐅᶠ([ fmap([ g_a, g_b ]), apply(concat) ])(obj)
export const properties  = obj => get_both(string_keyed_properties)(symbol_keyed_properties)(obj)
export const entries     = obj => get_both(string_keyed_entries)(symbol_keyed_entries)(obj)
export const object_copy = obj => ᐅᶠ([ properties, from_properties ])(obj)
export const from_properties = properties => fold(define_property_pair)(empty_object())(properties)
export const from_entries    = entries    => fold(define_entry_pair)(empty_object())(entries)
export const map_properties = f => ᐅᶠ([ properties, f, from_properties ])
export const map_entries    = f => ᐅᶠ([ entries, f, from_entries ])
export const mixin = a => b => ᐅᶠ([ map(properties), apply(concat), from_properties ])([ a, b ])

// strings
// NOTE(jordan): most array functions also work on strings
export const quote  = str => `"${str}"`
export const string = obj => has('toString')(obj) ? obj.toString() : `${obj}`

// pipelining
export const ᐅᶠ    =  ops =>  val => fold(call)(val)(ops)
export const ᐅif   = cond => t_fn => f_fn => val => cond(val) ? t_fn(val) : f_fn(val)
export const ᐅwhen = cond => t_fn => ᐅif(cond)(t_fn)(id)

// general
export const proxy = traps => target => new Proxy(target, traps)
export const None  = proxy({
  get (target, prop, recv) {
    const prop_in  = f => v => incl(prop)(f(v))
    const has_prop = prop_in(keys)
    /* EXPLANATION(jordan): Yeah... wtf wrt this next line. Lets None be push/concat/etc.-ed without
     * disappearing in the result array. This is an issue because of the way Symbols were designed
     * for backwards compatability -- basically, returning undefined is "good" and counts as the
     * same as if the Symbol (which is a required behavior and so has to be, in some sense, defined)
     * were set, and set to "false". This is because undefined is falsy. Fucking falsyness. Falsy
     * fucking falsy. Ugh. May be worth investigating how and why [].concat refers to
     * isConcatSpreadable in the first place; is this situation a single special case, or one of
     * many?
     */
    // TODO(jordan)?: exclude more well-known symbols?
    if (prop === Symbol.isConcatSpreadable) return target[prop]
    /* NOTE(jordan): ironically, valueOf works because its result is None anyway, but in general
     * prototype dispatch on properties is borked by this. We may want to consider if this causes
     * problems, and if so when/how...
     */
    return ᐅif(has_prop)(get(prop))(ret(None))(target)
  }
})(meta_fn.mut({
  toString () { return 'None' },
  [Symbol.toPrimitive] (hint) {
    if (hint === 'string') return 'None'
    if (hint === 'number') throw new Error('None is not a number and cannot be used as one')
    throw new Error('None is not a value and cannot be used here')
  }
})(_ => None))

// 3: depending on at most 3, 2 and 1
// functions
/* TODO(jordan):
 *  memoization
 */

// TODO(jordan): untested
export const first    = arr => get(0)(arr)
export const pop      = arr => fmap([ first, rest ])(arr)
export const get_path = path => obj => fold(get)(obj)(path)

// GOAL(jordan): update functions:
// update_path :: path   -> updater -> obj -> obj; updater is a ᐅdropn of the update arity / number of items you want
// update_walk :: walker -> updater -> obj -> obj; similar to path, but more choice: walker outlines many paths
// Examples: update_path([ 0, 0 ])(inc)([ [ 1 ] ]) => [ [ 2 ] ]
//           update_path([ 'items', 3, 'size' ])(sz => 2*sz)({ items: [ {}, {}, { name: 'thing', size: 1 } ] })... you
//            get the idea.
//          update_path(path)(updater) === update_walk(drill(path))(surface(updater))
//          in order to do more interesting things, we need a form of ᐅdrop that doesn't necessarily consume all the
//          results; ᐅdrop should be renamed ᐅconsume, and ᐅdrop should mean "end up with a lens". You can end the lens
//          by just taking the first value; I guess that's ᐅextract or something.
const type        = t => v => typeof v === t
const instance    = C => v => v instanceof C
const object_case = ({ array: a, object: o }) => ᐅwhen(type(t.object))(ᐅif(instance(Array))(a)(o))
export const reflex = { type, instance, object_case }

// primitive types : boolean, undefined, number, string, symbol, object
// weirdo types    : null (typeof null === 'object' but null is not an instance of an object)
//                   NaN  (NaN != NaN, typeof NaN === 'number', but NaN instanceof Number === false)
// object types    : literally everything else (boxed types, user objects, etc.)
// REFACTOR(jordan): module
const t = (function () {
  const number    = 'number'    // number literals, Number(), but not new Number (which is object)
  const object    = 'object'    // constructed instances (e.g. new class), literal objects
  const string    = 'string'    // string literals, String(), but not new String (which is object)
  const symbol    = 'symbol'    // symbols, well-known Symbols (e.g. Symbol.iterator)
  const boolean   = 'boolean'   // true, false, Boolean(), but not new Boolean (which is object)
  const function_ = 'function'  // functions, classes
  const undefined = 'undefined' // free variables, literal undefined
  return { number, object, string, symbol, boolean, function: function_, undefined }
})()

export const copy = object_case({ array: array_copy, object: object_copy })

// FIXME(jordan): these should take v => v functions...
const update_array  = i => v => splice(i)(1)([ v ])
const update_object = k => v => obj => mixin(obj)({ [k]: v })
export const update = k => v => object_case({ array: update_array(k)(v), object: update_object(k)(v) })

export const trace = adder => tracker => ᐅᶠ([ fmap([ adder, tracker ]), apply(cons) ])

const update_tracker = k => ([ o, fill_hole ]) => (v => fill_hole(update(k)(v)(o)))
export const trace_update = k => trace(ᐅᶠ([ first, get(k) ]))(update_tracker(k))
export const lens = path => object => fold(trace_update)([ object, id ])(path)

// arrays
const split_pair = fmap([ get(0), get(1) ])
const _delacer   = ([ a, b ]) => fmap([ ᐅᶠ([ get(0), cons(a) ]), ᐅᶠ([ get(1), cons(b) ]) ])
export const lace     = a => b => ᐅᶠ([ len, til, fmap([ flip(get)(a), flip(get)(b) ]) ])(a)
export const delace   = fold(_delacer)([[], []])
export const remove   = v => arr => on(arr)([ index(v), remdex ])

// ...? special for sisyphus
export const simple = v => v === null || incl(typeof v)([ 'function', 'number', 'string', 'boolean', 'undefined' ])

export function test (suite) {
  const to6 = [ 1, 2, 3, 4, 5 ]
  const just_hi = _ => "hi"

  return suite(`prettybad/μtil: worse than underscore`, [
    t => t.suite('functions', {
      'flip: flips args':
        t => t.eq(flip(a => b => a - b)(1)(2))(1),
      'id: id(6) is 6':
        t => t.eq(id(6))(6),
      'id: works on objects':
        t => t.eq(id({ a: 5 }))({ a: 5 }),
      'call: calls func':
        t => t.eq(call(id)(1))(1),
      'bind: binds ctx':
        t => t.eq(bind({ a: 7 })(function (v) { return this[v] })('a'))(7),
      'compose: composes':
        t => t.eq(compose(x => x + 5)(x => 2 * x)(1))(12),
      'ret: returns':
        t => t.eq(ret(5)())(5),
      'apply: applies function to array of args':
        t => t.eq(apply(function (a) { return b => a + b })([ 1, 2 ]))(3),
      'times: repeats a function a set number of times':
        t => t.eq(times(3)(x => x * 2)(2))(16),
      'and: true if all predicates are true':
        t => t.ok(and([ x => x % 2 === 0, x => x % 3 === 0, x => x < 10 ])(6)),
      'or: true if any predicate is true':
        t => t.ok(or([ x => x + 1 === 3, x => x + 1 === 2 ])(1)),
      'copy_fn: copies a function':
        t => t.eq(copy_fn(id)(id)) && !t.refeq(copy_fn(id))(id) && t.eq(copy_fn(id)(5))(id(5)),
      'mimic_fn: copies a function, keeping its name and toString':
        t => {
          const fn = x => x + 1
          const id = x => x
          const mimic = mimic_fn(id)(fn)
          return t.eq(mimic.name)(id.name)
              && t.eq(mimic.toString())(id.toString())
              && t.eq(mimic('hi'))(id('hi') + 1)
              && !t.refeq(mimic)(id)
              && !t.refeq(mimic)(fn)
        },
      'meta_fn: defines hidden properties on a copy of a function':
        t => {
          const fn = _ => 5
          const mf = meta_fn({ a: fn() })(fn)
          return t.eq(mf())(fn())
              && t.eq(mf.a)(fn())
              && !t.refeq(mf)(fn)
        },
      'named: names a function':
        t => t.eq(named('hello')(v => `hello, ${v}`).name)('hello'),
    }),
    t => t.suite('pipelining', {
      'ᐅᶠ: pipelines functions':
        t => t.eq(ᐅᶠ([ id, inc ])(1))(2),
      'ᐅif: inline if':
        t => t.eq(ᐅif(id)(_ => 5)(_ => 6)(true))(5) && t.eq(ᐅif(id)(_ => 5)(_ => 6)(false))(6),
      'ᐅwhen: one-armed inline if':
        t => t.eq(ᐅwhen(v => v % 2 === 0)(_ => 'even')(2))('even')
          && t.eq(ᐅwhen(v => v % 2 === 0)(_ => 'even')(1))(1),
    }),
    t => t.suite('numbers', {
      'inc: adds 1':
        t => t.eq(inc(1))(2),
      'dec: subtracts 1':
        t => t.eq(dec(5))(4),
    }),
    t => t.suite(`objects`, {
      'string_keys: lists string keys':
        t => t.eq(string_keys({ [Symbol.split]: just_hi, a: 4 }))(['a']),
      'symbol_keys: lists symbol keys':
        t => t.eq(symbol_keys({ [Symbol.split]: just_hi, a: 4 }))([Symbol.split]),
      'keys: lists both string and symbol keys':
        t => t.eq(keys({ [Symbol.split]: just_hi, a: 4 }))(['a', Symbol.split]),
      'string_keyed_values: lists string-keyed values':
        t => t.eq(string_keyed_values({ [Symbol.split]: just_hi, a: 4 }))([4]),
      'symbol_keyed_values: lists symbol-keyed values':
        t => t.eq(symbol_keyed_values({ [Symbol.split]: just_hi, a: 4 }))([ just_hi ]),
      // TODO
      // 'values: lists both symbol values and non-symbol values':
      //   t => t.eq(values({ [Symbol.split]: just_hi, a: 4 }))([ just_hi, 4 ]),
      'get_descriptor: gets property descriptor':
        t => t.eq(get_descriptor('a')({ a: 4 }))({ value: 4, writable: true, enumerable: true, configurable: true }),
      'define_props.mut: mutably sets properties on an object': t => {
        const o = { a: 5 }
        define_props.mut({ b: { value: 3 } })(o)
        define_props.mut({ a: { value: o.a + 1, enumerable: false } })(o)
        return t.eq(o.b)(3) && t.eq(o.a)(6) && t.eq(Object.keys(o))([])
      },
      'define_prop.mut: mutably sets a single property on an object': t => {
        const o = { a: 1 }
        define_prop.mut('b')({ value: 5 })(o)
        define_prop.mut('a')({ enumerable: false })(o)
        return t.eq(o.b)(5) && t.eq(o.a)(1) && t.eq(Object.keys(o))([])
      },
      'string_keyed_properties: gets descriptors for non-symbol properties':
        t => t.eq(string_keyed_properties({ a: 5 }))([['a', { value: 5, writable: true, enumerable: true, configurable: true }]]),
      'symbol_keyed_properties: gets descriptors for symbol properties':
        t => t.eq(symbol_keyed_properties({ [Symbol.split]: just_hi }))([[Symbol.split, { value: just_hi, writable: true, enumerable: true, configurable: true }]]),
      'properties: gets all descriptors':
        t => t.eq(properties({ a: 5, [Symbol.split]: just_hi }))([['a', { value: 5, writable: true, enumerable: true, configurable: true }], [Symbol.split, { value: just_hi, writable: true, enumerable: true, configurable: true }]]),
      'from_properties: converts [prop, desc] pairs to an object':
        t => t.eq(from_properties([['a', { configurable: true, writable: true, enumerable: true, value: 5 }]]))({ a: 5 }),
      'object_copy: (shallowly) clones an object':
        t => t.eq(object_copy({ a: 5 }))({ a: 5 }) && t.refeq(object_copy({ f: to6 }).f)(to6),
      'mixin: creates a new object combining properties of two source objects':
        t => t.eq(mixin({ a: 4 })({ a: 5 }))({ a: 5 }),
      'get: gets a key/index or None if not present':
        t => t.eq(get(0)([5]))(5) && t.eq(get('a')({}))(None),
      'get_path: gets a path of keys/indices or None if any part of path is not present':
        t => t.eq(get_path([ 'a', 'b', 'c' ])({ 'a': { 'b': { 'c': 5 } } }))(5)
          && t.eq(get_path([ 'a', 'b', 'd' ])({ 'a': { 'b': { 'c': 5 } } }))(None),
      'entries: gets {key,symbol}, value pairs':
        t => t.eq(entries({ a: 5, [Symbol.split]: just_hi }))([['a', 5], [Symbol.split, just_hi]]),
      'from_entries: turns {key,symbol}, value pairs into an object':
        t => t.eq(from_entries([['a', 5], ['b', just_hi]]))({ a: 5, b: just_hi }),
    }),
    t => t.suite('arrays', {
      'each: no effect':
        t => t.eq(each(v => v * v)(to6))(to6),
      'map: adds 1':
        t => t.eq(map(v => v + 1)(to6))([ 2, 3, 4, 5, 6 ]),
      'filter: keeps between 1 and 4':
        t => t.eq(filter(v => v < 4 && v > 1)(to6))([ 2, 3 ]),
      'concat: to6 and 123':
        t => t.eq(concat(to6)([ 1, 2, 3 ]))([ 1, 2, 3, 4, 5, 1, 2, 3 ]),
      'all: all to6 > 0':
        t => t.ok(all(v => v > 0)(to6)),
      'all: not all to6 < 1':
        t => !t.ok(all(v => v < 1)(to6)),
      'any: at least one of to6 is even':
        t => t.ok(any(v => v % 2 == 0)(to6)),
      'any: none of to6 is divisible by 10':
        t => !t.ok(any(v => v % 10 == 0)(to6)),
      'sort: sort() (default algorithm) of shuffled to6 is to6':
        t => t.eq(sort()([3, 1, 5, 4, 2]))(to6),
      'incl: to6 includes 5':
        t => t.ok(incl(5)(to6)),
      'incl: to6 does not include 0':
        t => !t.ok(incl(0)(to6)),
      'index: 3 is index 2 in to6':
        t => t.eq(index(3)(to6))(2),
      'index: -1 when not found':
        t => t.eq(index(123)(to6))(-1),
      'find: first even of to6 is 2':
        t => t.eq(find(v => v % 2 == 0)(to6))(2),
      'findex: first even of to6 is at index 1':
        t => t.eq(findex(v => v % 2 == 0)(to6))(1),
      'join: joins an array into a string':
        t => t.eq(join('+')(to6))('1+2+3+4+5'),
      'slice(0)(0): nothing':
        t => t.eq(slice(0)(0)(to6))([]),
      'slice(1)(): of to6 is 2..5':
        t => t.eq(slice(1)()(to6))([ 2, 3, 4, 5 ]),
      'slice(0)(3): of to6 is 1..3':
        t => t.eq(slice(0)(3)(to6))([ 1, 2, 3 ]),
      'skip(1): of to6 is same as slice(1)()':
        t => t.eq(skip(1)(to6))([ 2, 3, 4, 5 ]),
      'take(3): of to6 is same as slice(0)(3)':
        t => t.eq(take(3)(to6))([ 1, 2, 3 ]),
      'rest: same as slice(1)':
        t => t.eq(rest(to6))([ 2, 3, 4, 5 ]),
      'fold: sum of to6 is 15':
        t => t.eq(fold(v => acc => v + acc)(0)(to6))(15),
      'cons: cons [0] to to6 gives [0],1..5':
        t => t.eq(cons([ 0 ])(to6))([ [ 0 ], 1, 2, 3, 4, 5 ]),
      'len: len of to6 is 5':
        t => t.eq(len(to6))(5),
      'n_of: n_of 0 where n is 5 gives 5 zeroes':
        t => t.eq(n_of(0)(5))([ 0, 0, 0, 0, 0 ]),
      'push: to6 push [6] is 1..5,[6]':
        t => t.eq(push([ 6 ])(to6))([ 1, 2, 3, 4, 5, [ 6 ] ]),
      'flatten: flattening arbitrarily partitioned to6 is to6':
        t => t.eq(flatten([[1], [2, 3], 4, [5]]))(to6)
          && t.eq(flatten([ 1, [ 2, 3 ], [], [], 4 ]))([ 1, 2, 3, 4 ]),
      'flatmap: maps then flattens':
        t => t.eq(flatmap(v => [ v, v + 5 ])(to6))([ 1, 6, 2, 7, 3, 8, 4, 9, 5, 10 ]),
      'array_copy: s new copy of array':
        t => t.eq(array_copy(to6))(to6) && !t.refeq(array_copy(to6))(to6),
      'reverse: reverse of to6 is 5..1':
        t => t.eq(reverse(to6))([ 5, 4, 3, 2, 1 ]),
      'remove: removing 2 from to6 drops index 1':
        t => t.eq(remove(2)(to6))([ 1, 3, 4, 5 ]),
      'remdex: removing index 1 from to6 drops 2':
        t => t.eq(remdex(1)(to6))([ 1, 3, 4, 5 ]),
      // 'split: splits on delimeter':
      //   t => t.eq(split(',')('1,2,3,4,5'))(map(v => '' + v)(to6)),
    }),
    t => t.suite(`strings`, {
      'split: splits a string around a delimiter':
        t => t.eq(split_on(',')('a,b,c'))(['a', 'b', 'c']),
      'quote: surrounds a string in quotes':
        t => t.eq(quote('s'))('"s"'),
    }),
    t => t.suite(`None`, {
      'None: perpetuates itself and is None':
      t => {
        return t.eq(None.toString())('None')
            && t.eq(`${None}`)('None')
            && t.eq(None.a.b.c.hi())(None)
            // NOTE(jordan): see definition of None for why these tests make sense.
            && t.eq(concat(None)(5))([ None, 5 ])
            && t.eq(flatten([ id, None, flatten ]))([ id, None, flatten ])
      },
    }),
  ])
}
