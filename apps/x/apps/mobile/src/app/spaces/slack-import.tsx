import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { MAX_SLACK_ZIP_BYTES, type SlackImportJob, type SlackImportPreview } from '@rowboat/spaces-protocol';
import { spaces } from '@x/shared';
import { PrimaryButton } from '@/components/grouped';
import { markSpacesChanged, useOrgClient } from '@/lib/spaces/invites';
import { friendlyError } from '@/lib/spaces/errors';
import { useColors } from '@/theme/colors';

export default function SlackImportScreen() {
  const { org, me } = useLocalSearchParams<{ org: string; me: string }>();
  const client = useOrgClient(org);
  const colors = useColors();
  const [preview, setPreview] = useState<SlackImportPreview | null>(null);
  const [bytes, setBytes] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [append, setAppend] = useState(false);
  const [jobs, setJobs] = useState<SlackImportJob[]>([]);
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [operation, setOperation] = useState<'preview' | 'start' | 'retry' | null>(null);
  const busy = operation !== null;
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await client.listSlackImports(); if (!disposed) setJobs(result.jobs); }
      catch (e) { if (!disposed) setError(friendlyError(e)); }
      finally { if (!disposed) timer = setTimeout(poll, 2000); }
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [client]);
  const pick = async () => {
    setOperation('preview'); setError(''); setPreview(null); setBytes(''); setSelected([]); setPage(0); setQuery('');
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false, type: ['application/zip', 'application/x-zip-compressed'] });
      if (result.canceled) return;
      const file = new File(result.assets[0]!.uri);
      if (!file.size || file.size > MAX_SLACK_ZIP_BYTES) throw new Error('Choose a ZIP up to 100 MiB.');
      const data = await file.bytes();
      const summary = await client.previewSlackImport(data);
      setBytes(await file.base64()); setPreview(summary);
    } catch (e) { setError(friendlyError(e)); }
    finally { setOperation(null); }
  };
  const start = async () => {
    setOperation('start'); setError('');
    try {
      const job = await client.startSlackImport({ bytes, workspace: workspace.trim().toLowerCase(), channelIds: selected, existingChannels: append ? 'append' : 'skip' });
      setJobs(current => [job, ...current.filter(j => j.id !== job.id)]);
      setBytes(''); setPreview(null); setSelected([]); markSpacesChanged(org);
    } catch (e) { setError(friendlyError(e)); }
    finally { setOperation(null); }
  };
  const retry = async (id: string) => {
    setOperation('retry'); setError('');
    try { const job = await client.retrySlackImport(id); setJobs(current => [job, ...current.filter(j => j.id !== id)]); }
    catch (e) { setError(friendlyError(e)); }
    finally { setOperation(null); }
  };
  const label = { color: colors.label, fontSize: 15 };
  const input = { ...label, padding: 12, borderRadius: 10, backgroundColor: colors.card };
  const renderJob = (job: SlackImportJob) => {
    const { status, count, detail, percent } = spaces.slackImportProgress(job);
    const active = job.status === 'queued' || job.status === 'running';
    return <View key={job.id} style={{ gap: 8, padding: 12, borderRadius: 10, backgroundColor: colors.card }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        {active && <ActivityIndicator color={colors.label} size="small" />}
        <Text style={{ ...label, fontWeight: '600', flex: 1 }}>{status}</Text>
      </View>
      <Text style={{ color: colors.secondaryLabel }}>{job.workspace}</Text>
      <View accessible accessibilityRole="progressbar" accessibilityLabel={`Import progress for ${job.workspace}`} accessibilityValue={{ min: 0, max: 100, now: percent, text: [count, detail].filter(Boolean).join('. ') }} style={{ height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.separator }}>
        <View style={{ width: `${percent}%`, height: '100%', backgroundColor: colors.accent }} />
      </View>
      <Text accessibilityLiveRegion="polite" style={{ color: colors.secondaryLabel }}>{count}{detail && `\n${detail}`}</Text>
      {job.error && <Text style={{ color: colors.destructive }}>{job.error}</Text>}
      {job.status === 'failed' && <PrimaryButton label="Retry remaining channels" busy={busy} onPress={() => void retry(job.id)} />}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedJob === job.id }} onPress={() => setExpandedJob(expandedJob === job.id ? null : job.id)} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={label}>{expandedJob === job.id ? 'Hide channel details' : 'Show channel details'}</Text>
      </Pressable>
      {expandedJob === job.id && job.channels.map(c => <Pressable key={c.id} disabled={c.status === 'pending'} onPress={() => { markSpacesChanged(org); router.push({ pathname: '/spaces/chat', params: { org, me, space: c.spaceId, title: c.name } }); }}><Text style={label}>#{c.name} · {c.status}{c.status !== 'pending' ? ' →' : ''}</Text></Pressable>)}
    </View>;
  };
  return <ScrollView style={{ flex: 1, backgroundColor: colors.groupedBackground }} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
    <Stack.Screen options={{ title: 'Import from Slack' }} />
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><Image source={require('../../../assets/images/slack.svg')} style={{ width: 28, height: 28 }} /><Text style={{ ...label, fontWeight: '600' }}>Import from Slack</Text></View>
    {jobs[0] && renderJob(jobs[0])}
    <Text style={label}>Each channel becomes a new space, initially accessible only to you. Imports continue after you leave this screen.</Text>
    <PrimaryButton label={operation === 'preview' ? 'Checking export' : 'Choose Slack export ZIP'} busy={operation === 'preview'} disabled={busy} onPress={() => void pick()} />
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    {preview && <>
      <Text style={label}>{preview.channels.length} channels · {preview.records.accepted} accepted records · {preview.records.skipped} skipped</Text>
      <TextInput accessibilityLabel="Search channels" placeholder="Search channels" placeholderTextColor={colors.tertiaryLabel} style={input} value={query} onChangeText={text => { setQuery(text); setPage(0); }} />
      {preview.channels.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).slice(page * 50, (page + 1) * 50).map(c => <Pressable key={c.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(c.id) }} onPress={() => setSelected(ids => ids.includes(c.id) ? ids.filter(id => id !== c.id) : [...ids, c.id])} style={{ padding: 12, borderRadius: 10, backgroundColor: colors.card }}>
        <Text style={label}>{selected.includes(c.id) ? '☑' : '☐'} #{c.name} · {c.messages} messages / {c.replies} replies</Text>
        <Text style={{ color: colors.secondaryLabel }}>{c.private ? 'Private' : 'Public'}{c.archived ? ' · Archived' : ''}</Text>
      </Pressable>)}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Pressable disabled={!page} onPress={() => setPage(page - 1)}><Text style={label}>Previous</Text></Pressable>
        <Text style={label}>Page {page + 1}</Text>
        <Pressable disabled={(page + 1) * 50 >= preview.channels.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).length} onPress={() => setPage(page + 1)}><Text style={label}>Next</Text></Pressable>
      </View>
      {preview.warnings.slice(0, 100).map((w, i) => <Text key={i} style={{ color: colors.secondaryLabel }}>{w.path}: {w.detail}</Text>)}
      {preview.warnings.length > 100 && <Text style={label}>Showing the first 100 warnings.</Text>}
      <TextInput accessibilityLabel="Slack workspace domain" placeholder="team.slack.com" placeholderTextColor={colors.tertiaryLabel} autoCapitalize="none" autoCorrect={false} style={input} value={workspace} onChangeText={setWorkspace} />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><Switch accessibilityLabel="Append new messages" value={append} onValueChange={setAppend} /><Text style={{ ...label, flex: 1 }}>Append new messages to previously imported channels</Text></View>
      <Text style={{ color: colors.secondaryLabel }}>Use the same workspace domain on repeat imports. Existing messages stay unchanged. File links are preserved; attachments are not downloaded.</Text>
      <PrimaryButton label={operation === 'start' ? 'Starting import' : `Import ${selected.length} channels`} busy={operation === 'start'} disabled={busy || !selected.length || selected.length > 100 || !workspace.trim() || jobs.some(j => ['queued', 'running'].includes(j.status))} onPress={() => void start()} />
    </>}
    {jobs.slice(1).map(renderJob)}
  </ScrollView>;
}
