#!/usr/bin/env python3
"""Builds the editor's Browse catalogs (plugin/.../catalog/simvars.json, events.json) from the
MSFS 2024 SDK documentation (docs.flightsimulator.com): every simvar, environment variable and
key event listed there. Hand-picked common entries (catalog/common-*.json) come first, marked
with a star; the full SDK lists follow by category.

    python3 scripts/build-catalog.py            # downloads the SDK pages (needs network access)
    python3 scripts/build-catalog.py <dir>      # uses pages saved in <dir> (sv/*.htm, ev/*.htm)
"""
import html
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(__file__), '..', 'plugin', 'com.m18switchboard.msfs.sdPlugin', 'catalog')
BASE = 'https://docs.flightsimulator.com/msfs2024/retail/programming-apis/'

SIMVAR_PAGES = {
    'simvars/aircraft-simvars/aircraft-autopilot-and-assistant-variables': 'Autopilot',
    'simvars/aircraft-simvars/aircraft-brake-and-landing-gear-variables': 'Gear & brakes',
    'simvars/aircraft-simvars/aircraft-control-variables': 'Flight controls',
    'simvars/aircraft-simvars/aircraft-electrics-variables': 'Electrical',
    'simvars/aircraft-simvars/aircraft-engine-variables': 'Engine',
    'simvars/aircraft-simvars/aircraft-flight-model-variables': 'Flight model',
    'simvars/aircraft-simvars/aircraft-fuel-variables': 'Fuel',
    'simvars/aircraft-simvars/aircraft-miscellaneous-variables': 'Aircraft misc',
    'simvars/aircraft-simvars/aircraft-radio-navigation-variables': 'Radios & navigation',
    'simvars/aircraft-simvars/aircraft-system-variables': 'Aircraft systems',
    'simvars/balloon-and-airship-variables': 'Balloon & airship',
    'simvars/camera-variables': 'Camera',
    'simvars/helicopter-variables': 'Helicopter',
    'simvars/miscellaneous-variables': 'Sim misc',
    'simvars/services-variables': 'Services',
    'environment-variables': 'Time & environment',
}
EVENT_PAGES = {
    'aircraft-autopilot-and-flight-assistance-events': 'Autopilot',
    'aircraft-electrical-events': 'Electrical',
    'aircraft-engine-events': 'Engine',
    'aircraft-flight-control-events': 'Flight controls',
    'aircraft-fuel-system-events': 'Fuel',
    'aircraft-general-systems-events': 'Aircraft systems',
    'aircraft-instrumentation-events': 'Instruments',
    'aircraft-miscellaneous-events': 'Aircraft misc',
    'aircraft-radio-navigation-events': 'Radios & navigation',
    'balloon-and-airship-specific-events': 'Balloon & airship',
    'helicopter-specific-events': 'Helicopter',
    'miscellaneous-events': 'Sim misc',
    'view-and-camera-events': 'Camera',
}

# Units as the docs write them -> the unit names SimConnect takes. None: not readable as one value.
UNIT_FIX = {
    'boolean': 'bool', 'bool/string': 'bool', 'percentage': 'percent', 'gallon': 'gallons', 'gallon s per hour': 'gallons per hour',
    'ft': 'feet', 'lbs': 'pounds', 'lbs per hour': 'pounds per hour', 'float': 'number', 'ratio': 'number', '-': 'number',
    'integer / hexadecimal': 'number', 'integer': 'number', 'integer:': 'number', 'number:': 'number', 'scalar': 'number',
    'flags:': 'number', 'mask:': 'mask', 'radians/π': 'number', 'frequency frequency bcd16': 'frequency bcd16', 'knot s': 'knots',
    'kias': 'knots', 'feet ( ft per second': 'feet per second', 'ft per second': 'feet per second', 'feet /minute': 'feet per minute',
    'inches of mercury, inhg': 'inches of mercury', 'psf': 'pounds per square foot', 'pounds per square foot, psf': 'pounds per square foot',
    'kilo pascal': 'kilopascal', 'nm': 'nautical miles', 'meter': 'meters', 'cubic meter': 'cubic meters',
    'slug / ft³': 'slugs per cubic feet', 'fs7 oil quantity': 'percent over 100', 'pid_struct': None, 'simconnect_data_waypoint': None,
    'no longer used in the simulation.': None,
}


def page(src, rel, kind):
    name = rel.rstrip('/').split('/')[-1]
    if src:
        with open(os.path.join(src, kind, name + '.htm'), encoding='utf-8') as f:
            return name, f.read()
    with urllib.request.urlopen(BASE + rel + '/') as r:
        return name, r.read().decode('utf-8')


def text(s, sep=' '):
    s = re.sub(r'<span></span>|<br\s*/?>', '; ', s)
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', sep, s)).split())


def tables(t):
    for tb in re.findall(r'<table[^>]*>(.*?)</table>', t, re.S):
        head = [text(h) for h in re.findall(r'<th[^>]*>(.*?)</th>', tb, re.S)]
        rows = [re.findall(r'<td[^>]*>(.*?)</td>', r, re.S) for r in re.findall(r'<tr>(.*?)</tr>', tb, re.S)]
        yield head, [r for r in rows if r]


def unit_of(raw, desc):
    main = ' '.join(re.sub(r'\(.*?\)', '', raw.split(';')[0]).strip().lower().split())
    if main.startswith('enum'):
        return 'enum', desc
    if main.startswith('struct'):
        return None, desc
    if main.startswith('string'):
        return 'string', desc
    if main.startswith('position'):
        return 'position', desc
    if main in UNIT_FIX:
        return UNIT_FIX[main], desc
    if len(main) > 28 or main.endswith('.'):  # a shifted table row: the "unit" is a sentence
        return 'number', f'{desc} {raw}'.strip()
    return main, desc


def simvars(src):
    out, seen = [], set()
    for rel, cat in SIMVAR_PAGES.items():
        _, t = page(src, rel, 'sv')
        for head, rows in tables(t):
            if head and head[0] == 'Variable':  # environment variables: Variable, Units, Description
                head = ['Simulation Variable', 'Units', 'Description']
            if not head or head[0] != 'Simulation Variable':
                continue
            col = {h: i for i, h in enumerate(head)}
            for r in rows:
                names = re.findall(r'<code>([^<]+)</code>', r[0])
                if not names:
                    continue
                get = lambda k, sep=' ': text(r[col[k]], sep) if k in col and col[k] < len(r) else ''
                raw = get('Units', '')
                unit, desc = unit_of(raw, get('Description'))
                if not unit:
                    continue
                index = get('Index')
                indexed = index not in ('', 'N/A', '-')
                extra = []
                if indexed:
                    extra.append(f'indexed ({index}): :1, :2 …')
                if unit == 'enum' and ';' in raw:
                    extra.append(raw.split(';', 1)[1].strip(' ;'))
                if 'Settable' in col and col['Settable'] < len(r) and 'checkmark_stem' in r[col['Settable']]:
                    extra.append('settable')
                if extra:
                    desc = f'{desc} [{"; ".join(extra)}]'
                for n in names:
                    n = html.unescape(n).strip()
                    if indexed and ':' not in n:
                        n += ':1'
                    if n in seen:
                        continue
                    seen.add(n)
                    out.append({'cat': cat, 'name': n, 'unit': unit, 'desc': desc})
    return out


def events(src):
    out, seen = [], set()
    for rel, cat in EVENT_PAGES.items():
        _, t = page(src, 'key-events/' + rel, 'ev')
        for head, rows in tables(t):
            if not head or head[0] != 'Key Name':
                continue
            col = {h: i for i, h in enumerate(head)}
            for r in rows:
                names = re.findall(r'<code>([A-Z0-9_]+)</code>', r[0])
                get = lambda k: text(r[col[k]]) if k in col and col[k] < len(r) else ''
                params = get('Parameters')
                desc = get('Description') + (f' [value: {params}]' if params and params not in ('N/A', '-') else '')
                for n in names:
                    if n in seen:
                        continue
                    seen.add(n)
                    out.append({'cat': cat, 'name': n, 'desc': desc})
    return out


def merge(common, full):
    """Common entries first, starred; the SDK list after, without repeating them."""
    have = {c['name'] for c in common}
    starred = [{**c, 'cat': f'★ {c["cat"]}', 'common': True} for c in common]
    return starred + [f for f in full if f['name'] not in have]


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    for kind, build in (('simvars', simvars), ('events', events)):
        with open(os.path.join(ROOT, f'common-{kind}.json'), encoding='utf-8') as f:
            common = json.load(f)
        full = build(src)
        merged = merge(common, full)
        with open(os.path.join(ROOT, f'{kind}.json'), 'w', encoding='utf-8') as f:
            json.dump(merged, f, indent=0, ensure_ascii=False)
            f.write('\n')
        print(f'{kind}: {len(common)} common + {len(full)} from the SDK -> {len(merged)}')


if __name__ == '__main__':
    main()
