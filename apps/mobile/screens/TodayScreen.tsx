import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as FileSystem from 'expo-file-system/legacy';
import { ViewShotRef } from "react-native-view-shot";
import { supabase, supabaseErrorMessage } from "../supabase";
import {
  formatDate,
  monthName,
  PAYMENT_MODES,
  rupees,
  toPaise,
  toRupees,
  todayISO,
} from "../chit";
import { receiptImageSavedLocation, RECEIPT_SELECT, saveReceiptImageToDevice, shareReceiptImageToWhatsApp } from "../receipts";
import { ScreenProps } from "../navigation";
import { styles as st } from "../styles";
import ReceiptShareCard from "../ReceiptShareCard";

/** Today's receipts with totals by mode, for tallying cash in hand at the end of the day. */
export default function TodayScreen({ navigation }: ScreenProps<"Today">) {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [sharing, setSharing] = useState("");
  const [shareTarget, setShareTarget] = useState<any>(null);
  const [downloadTarget, setDownloadTarget] = useState<any>(null);
  const [paperScanUri, setPaperScanUri] = useState<string | null>(null);
  const [canUpdateCheque, setCanUpdateCheque] = useState(false);
  const [canManageReceipts, setCanManageReceipts] = useState(false);
  const [receiptAction, setReceiptAction] = useState<{ receipt: any; mode: 'edit' | 'delete' } | null>(null);
  const [correctionAmount, setCorrectionAmount] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const imageRef = useRef<ViewShotRef>(null);
  const downloadImageRef = useRef<ViewShotRef>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("receipts")
      .select(RECEIPT_SELECT)
      .eq("receipt_date", todayISO())
      .order("receipt_no", { ascending: false });
    setLoading(false);
    if (error)
      Alert.alert(
        "Could not load receipts",
        supabaseErrorMessage(error.message),
      );
    else setRows(data ?? []);
  }, []);
  useEffect(() => {
    void load();
    void supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();
      setCanUpdateCheque(["owner", "manager"].includes(profile?.role));
      setCanManageReceipts(profile?.role === 'owner');
    });
  }, [load]);

  const active = rows.filter((r) => r.status === "ACTIVE");
  const total = active.reduce((s, r) => s + Number(r.total), 0);

  const q = search.trim().toLowerCase();
  const filteredRows = rows.filter((r) => {
    if (!q) return true;
    const memberName = r.memberships?.customers?.name || "";
    const series = r.memberships?.chit_groups?.series || "";
    const receiptNo = String(r.receipt_no);
    const phone = r.memberships?.customers?.phone || "";
    return `${memberName} ${series} ${receiptNo} ${phone}`
      .toLowerCase()
      .includes(q);
  });

  const downloadReceiptImage = async (r: any) => {
    setSharing(r.id);
    try {
      const uri = await downloadImageRef.current?.capture();
      if (!uri) throw new Error("Receipt image is not ready. Try again.");
      await saveReceiptImageToDevice(uri, r.receipt_no);
      setShareTarget(null);
      Alert.alert("Receipt saved", `The receipt image is in ${receiptImageSavedLocation()}.`);
    } catch (e) {
      Alert.alert(
        "Could not save receipt image",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setSharing("");
      setDownloadTarget(null);
    }
  };

  useEffect(() => {
    if (!downloadTarget) return;
    requestAnimationFrame(() => requestAnimationFrame(() => { void downloadReceiptImage(downloadTarget); }));
  }, [downloadTarget]);

  useEffect(() => {
    let active = true;
    setPaperScanUri(null);
    const path = shareTarget?.receipt_scan_attachments?.[0]?.object_path;
    if (!path) return;
    void supabase.storage.from('receipt-scans').createSignedUrl(path, 60).then(({ data, error }) => {
      if (active && !error) setPaperScanUri(data?.signedUrl ?? null);
    });
    return () => { active = false; };
  }, [shareTarget]);

  const shareReceiptImage = async () => {
    if (!shareTarget) return;
    setSharing(shareTarget.id);
    try {
      const uri = await imageRef.current?.capture();
      if (!uri) throw new Error("Receipt image is not ready. Try again.");
      const attachments = [uri];
      if (paperScanUri) {
        const localPaperScan = `${FileSystem.cacheDirectory}paper-receipt-${shareTarget.receipt_no}.jpg`;
        const downloaded = await FileSystem.downloadAsync(paperScanUri, localPaperScan);
        attachments.push(downloaded.uri);
      }
      const directWhatsAppShare = await shareReceiptImageToWhatsApp(attachments, shareTarget, shareTarget.memberships?.customers?.phone);
      setShareTarget(null);
      Alert.alert(
        directWhatsAppShare ? "Receipt ready in WhatsApp" : "Receipt image shared",
        directWhatsAppShare ? "The receipt image and message are prepared for the member. Review them and tap Send in WhatsApp." : "Choose WhatsApp from the share options, select the member, then tap Send.",
      );
    } catch (e) {
      Alert.alert(
        "Could not share receipt to WhatsApp",
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setSharing("");
    }
  };
  const openScan = async (r: any) => {
    const path = r.receipt_scan_attachments?.[0]?.object_path;
    if (!path) return;
    const { data, error } = await supabase.storage
      .from("receipt-scans")
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      Alert.alert(
        "Could not open receipt photo",
        supabaseErrorMessage(error?.message || "Private scan unavailable"),
      );
      return;
    }
    Linking.openURL(data.signedUrl).catch(() =>
      Alert.alert("Could not open photo", "Try again after refreshing."),
    );
  };

  const updateCheque = (r: any) =>
    Alert.alert("Cheque clearance", `Receipt #${r.receipt_no}`, [
      {
        text: "Mark cleared",
        onPress: () => {
          void saveCheque(r.id, "CLEARED");
        },
      },
      {
        text: "Mark bounced",
        style: "destructive",
        onPress: () => {
          void saveCheque(r.id, "BOUNCED");
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  const saveCheque = async (
    receiptId: string,
    status: "CLEARED" | "BOUNCED",
  ) => {
    const { error: e } = await supabase.rpc("set_cheque_clearance", {
      p_receipt_id: receiptId,
      p_status: status,
      p_notes: status === "BOUNCED" ? "Marked bounced in mobile app" : null,
    });
    if (e)
      Alert.alert("Could not update cheque", supabaseErrorMessage(e.message));
    else await load();
  };

  const openReceiptAction = (receipt: any, mode: 'edit' | 'delete') => {
    setReceiptAction({ receipt, mode });
    setCorrectionAmount(String(toRupees(receipt.total)));
    setCorrectionReason('');
  };

  const saveReceiptAction = async () => {
    if (!receiptAction || !correctionReason.trim()) {
      Alert.alert('Reason required', 'Enter a reason for this receipt change.');
      return;
    }
    const { receipt, mode } = receiptAction;
    const amount = Number(correctionAmount);
    if (mode === 'edit' && (!Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(toPaise(amount)))) {
      Alert.alert('Invalid amount', 'Enter a valid corrected amount greater than zero.');
      return;
    }
    setCorrecting(true);
    try {
      if (mode === 'delete') {
        const { error } = await supabase.from('receipts').update({
          status: 'CANCELLED', cancelled_reason: correctionReason.trim(),
        }).eq('id', receipt.id);
        if (error) throw new Error(error.message);
        setReceiptAction(null);
        await load();
      } else {
        const { data: replacementId, error } = await supabase.rpc('correct_receipt_amount', {
          p_receipt_id: receipt.id,
          p_new_amount: toPaise(amount),
          p_reason: correctionReason.trim(),
        });
        if (error) throw new Error(error.message);
        const { data: replacement, error: fetchError } = await supabase.from('receipts')
          .select(RECEIPT_SELECT).eq('id', replacementId).single();
        if (fetchError) throw new Error(fetchError.message);
        setReceiptAction(null);
        await load();
        setShareTarget(replacement);
      }
    } catch (e) {
      Alert.alert('Could not update receipt', supabaseErrorMessage(e instanceof Error ? e.message : String(e)));
    } finally {
      setCorrecting(false);
    }
  };

  return (
    <View style={st.page}>
      <TouchableOpacity style={st.homeBtn} onPress={() => navigation.goBack()}>
        <Text style={st.homeBtnText}>‹ Home</Text>
      </TouchableOpacity>
      <Text style={st.title}>Today's collection</Text>
      <Text style={st.lb}>
        {formatDate(todayISO())} · {active.length} active receipts
      </Text>

      <View
        style={[st.card, { borderLeftWidth: 4, borderLeftColor: "#11734b" }]}
      >
        <Text style={st.tileValue}>{rupees(total)}</Text>
        {PAYMENT_MODES.map((mode) => {
          const modeTotal = active
            .filter((r) => r.mode === mode)
            .reduce((s, r) => s + Number(r.total), 0);
          if (modeTotal === 0) return null;
          return (
            <View key={mode} style={st.row}>
              <Text>{mode}</Text>
              <Text style={{ fontWeight: "600" }}>{rupees(modeTotal)}</Text>
            </View>
          );
        })}
      </View>

      <TextInput
        style={st.in}
        placeholder="Search today's receipts by name or receipt #"
        placeholderTextColor="#858585"
        value={search}
        onChangeText={setSearch}
      />

      <FlatList
        data={filteredRows}
        keyExtractor={(r) => r.id}
        refreshing={loading}
        onRefresh={load}
        ListEmptyComponent={
          <Text>
            {loading ? "Loading…" : "No matching payments found for today."}
          </Text>
        }
        renderItem={({ item: r }) => (
          <View style={[st.card, r.status === "CANCELLED" && { opacity: 0.5 }]}>
            <View style={st.row}>
              <Text style={[st.name, { flex: 1 }]}>
                {r.memberships?.customers?.name || "Member"}
              </Text>
              <Text
                style={[
                  st.name,
                  { color: r.status === "CANCELLED" ? "#999" : "#11734b" },
                ]}
              >
                {rupees(r.total)}
              </Text>
            </View>
            <Text style={st.hint}>
              Receipt #{r.receipt_no}
              {r.legacy_receipt_sources?.[0]
                ? ` · Paper ${r.legacy_receipt_sources[0].paper_receipt_no || "—"}${Number(r.legacy_receipt_sources[0].bp_adjustment) > 0 ? ` · BP adj. ${rupees(r.legacy_receipt_sources[0].bp_adjustment)}` : ''}${Number(r.legacy_receipt_sources[0].agent_commission_adjustment) > 0 ? ` · Agent commission adj. ${rupees(r.legacy_receipt_sources[0].agent_commission_adjustment)}` : ''}`
                : ""}{" "}
              · {r.memberships?.chit_groups?.series} #{r.memberships?.ticket_no}{" "}
              · {monthName(r.month_label)} · {r.mode}
              {r.cheque_tracking
                ? ` · ${r.cheque_tracking.clearance_status}`
                : ""}
              {r.status === "CANCELLED" ? " · CANCELLED" : ""}
            </Text>
            {r.receipt_scan_attachments?.length > 0 && (
              <TouchableOpacity
                style={[st.smallBtn, { alignSelf: "flex-start", marginTop: 6 }]}
                onPress={() => {
                  void openScan(r);
                }}
              >
                <Text>📷 View paper scan</Text>
              </TouchableOpacity>
            )}
            {!!r.receipt_scan_attachments?.[0]?.recognized_text && (
              <Text style={st.hint} numberOfLines={3}>
                OCR: {r.receipt_scan_attachments[0].recognized_text}
              </Text>
            )}
            {canUpdateCheque &&
              r.mode === "Cheque" &&
              r.cheque_tracking?.clearance_status === "PENDING" && (
                <TouchableOpacity
                  style={[
                    st.smallBtn,
                    { alignSelf: "flex-start", marginTop: 6 },
                  ]}
                  onPress={() => updateCheque(r)}
                >
                  <Text>Update cheque status</Text>
                </TouchableOpacity>
              )}
            {r.status === "ACTIVE" && (
              <View
                style={[st.row, { justifyContent: "flex-start", marginTop: 8 }]}
              >
                <TouchableOpacity
                  style={[st.smallBtn, { backgroundColor: "#e7f8ee" }]}
                  onPress={() => setShareTarget(r)}
                >
                  <Text style={{ color: "#0b6b37", fontWeight: "600" }}>
                    💬 Chat image
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[st.smallBtn, { backgroundColor: "#f0f0f0" }]}
                  disabled={sharing === r.id}
                  onPress={() => setDownloadTarget(r)}
                >
                  <Text>{sharing === r.id ? "Saving…" : "Receipt ⬇️"}</Text>
                </TouchableOpacity>
              </View>
            )}
            {canManageReceipts && r.status === 'ACTIVE' && <View style={[st.row, { justifyContent: 'flex-start', flexWrap: 'wrap', marginTop: 6 }]}>
              {!r.legacy_receipt_sources?.length && !(r.mode === 'Cheque' && r.cheque_tracking?.clearance_status !== 'PENDING') &&
                <TouchableOpacity style={st.smallBtn} onPress={() => openReceiptAction(r, 'edit')}><Text>Edit amount</Text></TouchableOpacity>}
              <TouchableOpacity style={[st.smallBtn, { backgroundColor: '#fdeaea' }]} onPress={() => openReceiptAction(r, 'delete')}>
                <Text style={{ color: '#820F10' }}>Delete / reverse</Text>
              </TouchableOpacity>
            </View>}
          </View>
        )}
      />
      <Modal
        visible={!!shareTarget}
        transparent
        animationType="slide"
        onRequestClose={() => setShareTarget(null)}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            backgroundColor: "#0008",
          }}
        >
          <View
            style={{
              maxHeight: "92%",
              backgroundColor: "#f6f5fa",
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 16,
            }}
          >
            <View style={[st.row, { marginBottom: 8 }]}>
              <Text style={st.name}>Receipt image preview</Text>
              <TouchableOpacity
                style={st.smallBtn}
                onPress={() => setShareTarget(null)}
              >
                <Text>Close</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[st.btn, { backgroundColor: "#25D366" }]}
              disabled={sharing === shareTarget?.id || (!!shareTarget?.receipt_scan_attachments?.length && !paperScanUri)}
              onPress={() => {
                void shareReceiptImage();
              }}
            >
              <Text style={st.bt}>
                {sharing === shareTarget?.id
                  ? "Preparing image…"
                  : !!shareTarget?.receipt_scan_attachments?.length && !paperScanUri ? "Loading paper photo…" : "💬 Open member’s Chat"}
              </Text>
            </TouchableOpacity>
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 1 }}
              showsVerticalScrollIndicator
            >
              {shareTarget && (
                <ReceiptShareCard ref={imageRef} receipt={shareTarget} />
              )}
              {paperScanUri && <><Text style={st.lb}>Original paper receipt photo (also attached in WhatsApp)</Text><Image source={{ uri: paperScanUri }} style={{ width: '100%', height: 180 }} resizeMode="contain" /></>}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={!!receiptAction} transparent animationType="fade" onRequestClose={() => setReceiptAction(null)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#0008' }}>
          <View style={[st.card, { backgroundColor: '#fff' }]}>
            <Text style={st.name}>{receiptAction?.mode === 'edit' ? 'Correct receipt amount' : 'Delete / reverse receipt'}</Text>
            <Text style={st.hint}>Receipt #{receiptAction?.receipt.receipt_no}. The original record will be retained for audit.</Text>
            {receiptAction?.mode === 'edit' && <TextInput style={st.in} placeholder="Correct amount (₹)" keyboardType="decimal-pad"
              value={correctionAmount} onChangeText={setCorrectionAmount} />}
            <TextInput style={st.in} placeholder="Reason for change" value={correctionReason} onChangeText={setCorrectionReason}
              multiline maxLength={500} />
            <TouchableOpacity style={st.btn} disabled={correcting || !correctionReason.trim()} onPress={() => { void saveReceiptAction(); }}>
              <Text style={st.bt}>{correcting ? 'Saving…' : receiptAction?.mode === 'edit' ? 'Save corrected receipt' : 'Cancel and reverse receipt'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={st.smallBtn} disabled={correcting} onPress={() => setReceiptAction(null)}><Text>Keep receipt</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      {downloadTarget && <View pointerEvents="none" style={{ position: 'absolute', left: -10000, top: 0 }}>
        <ReceiptShareCard ref={downloadImageRef} receipt={downloadTarget} />
      </View>}
    </View>
  );
}
