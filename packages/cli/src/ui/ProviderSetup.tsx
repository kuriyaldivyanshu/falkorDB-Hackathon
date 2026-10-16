import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import type { ProviderSettingsView, SavedProviderView } from '@threadline/shared';
import type { ProviderClient } from '../transport/provider-client.js';

type Step = 'choose' | 'action' | 'model' | 'key' | 'confirm' | 'check' | 'remove' | 'busy' | 'done';
export function ProviderSetup({ client, onClose }: { client: ProviderClient; onClose: () => void }) {
  const [view, setView] = useState<ProviderSettingsView | null>(null);
  const [selected, setSelected] = useState<SavedProviderView | null>(null);
  const [step, setStep] = useState<Step>('choose');
  const [input, setInput] = useState(''), [model, setModel] = useState(''), [message, setMessage] = useState('');
  const privateKey = useRef(''), alive = useRef(true);
  useEffect(() => { alive.current = true; void client.list().then(setView).catch(() => setMessage('Provider settings are unavailable. Check your owner session and backend.'));
    return () => { alive.current = false; privateKey.current = ''; }; }, [client]);
  function close() { privateKey.current = ''; setInput(''); onClose(); }
  useInput((_input, key) => { if (key.escape && step !== 'busy') close(); });
  async function perform(operation: () => Promise<void>) {
    setStep('busy'); setMessage(''); setInput('');
    try { await operation(); if (alive.current) setStep('done'); }
    catch (error) { if (alive.current) { setMessage(error instanceof Error ? error.message : 'Provider setup failed.'); setStep('done'); } }
    finally { privateKey.current = ''; }
  }
  function submit() {
    const value = input.trim(); setInput('');
    if (step === 'done') { close(); return; }
    if (step === 'choose') {
      const provider = view?.providers[Number(value) - 1];
      if (!provider) { setMessage('Enter a provider number from the list.'); return; }
      setSelected(provider); setMessage(''); setStep(provider.saved ? 'action' : 'model'); return;
    }
    if (!selected) return;
    if (step === 'action') {
      if (value === '1') void perform(async () => { await client.select(selected.id); setMessage('Saved provider selected. Prepare a new run to use it.'); });
      else if (value === '2') setStep('check');
      else if (value === '3') setStep('model');
      else if (value === '4') setStep('remove');
      else { setMessage('Choose 1, 2, 3 or 4.'); }
    } else if (step === 'model') {
      if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value)) { setMessage('Enter the provider’s exact model ID.'); return; }
      setModel(value); setMessage(''); setStep('key');
    } else if (step === 'key') {
      if (!/^[\x21-\x7e]{8,8192}$/.test(value)) { setMessage('Paste a key without spaces or line breaks.'); return; }
      privateKey.current = value; setMessage(''); setStep('confirm');
    } else if (step === 'confirm') {
      if (value.toLowerCase() !== 'connect') { privateKey.current = ''; setStep('key'); return; }
      const key = privateKey.current; privateKey.current = '';
      void perform(async () => { const result = await client.connect({ provider: selected.id, model, apiKey: key, allowInferenceTest: selected.inferenceCheckRequired });
        setMessage(result.saved ? 'Key validated, saved and selected. Prepare a new run to use it.' : `${result.validation.message} Existing saved keys were preserved.`); });
    } else if (step === 'check') {
      if (value.toLowerCase() !== 'test') { close(); return; }
      void perform(async () => { const result = await client.check(selected.id, selected.inferenceCheckRequired); setMessage(result.message); });
    } else if (step === 'remove') {
      if (value.toLowerCase() !== 'remove') { close(); return; }
      void perform(async () => { await client.remove(selected.id); setMessage('Saved key removed. If it was active, inference is disabled until another provider is selected.'); });
    }
  }
  const prompts: Partial<Record<Step, string>> = { choose: 'Provider number', action: 'Action number', model: 'Model ID', key: 'API key (masked)', confirm: 'Type connect to validate, save and select', check: 'Type test to check the saved key', remove: 'Type remove to delete this saved key', done: 'Press Enter to return' };
  return <Box flexDirection="column">
    <Text bold>Connect a model provider</Text>
    {step === 'choose' && view?.providers.map((p, index) => <Text key={p.id}>{index + 1}. {p.label}{p.active ? ' — active' : p.saved ? ' — saved' : ''}{p.validation ? ` / last key check: ${p.validation.state}` : ''}</Text>)}
    {selected && <Text>{selected.label}{model ? ` / ${model}` : ''}</Text>}
    {step === 'action' && <Text>1. Use saved key   2. Check key   3. Replace key/model   4. Remove key</Text>}
    {step === 'key' && <Text dimColor>Your key is sent only to the local backend and this provider. It will not appear in activity or shell history.</Text>}
    {step === 'confirm' && <Text dimColor>Stored in an owner-only local file, outside the repository. Storage is not encrypted. A successful check activates this provider.</Text>}
    {(step === 'confirm' || step === 'check') && <Text color={selected?.inferenceCheckRequired ? 'yellow' : undefined}>
      {selected?.inferenceCheckRequired ? 'This sends one tiny inference test and consumes provider allowance. No workspace content is sent.' : 'This checks authenticated metadata without starting inference. Model/tool compatibility is checked separately.'}
    </Text>}
    {step === 'remove' && <Text color="yellow">Removes the locally saved key. It does not revoke the key at the provider.</Text>}
    {step === 'busy' ? <Text>Checking or saving provider settings…</Text> : step === 'choose' && !view ? <Text>Loading saved provider settings…</Text> : <Box><Text>{prompts[step]}: </Text><TextInput value={input} mask={step === 'key' ? '*' : undefined}
      highlightPastedText={false} onChange={v => { if (v.length > (step === 'key' ? 8192 : 128)) { setMessage('Input is too long. Nothing was submitted.'); return; } setInput(v); }} onSubmit={submit} /></Box>}
    {message && <Text>{message}</Text>}
    <Text dimColor>{step === 'busy' ? 'Wait for this operation to finish; it is not retried automatically.' : 'Esc returns without submitting another operation.'}</Text>
  </Box>;
}
