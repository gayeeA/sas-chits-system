import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { ViewShotRef } from "react-native-view-shot";
import { supabase, supabaseErrorMessage } from "../supabase";
import {
  formatDate,
  monthName,
  PAYMENT_MODES,
  rupees,
  todayISO,
} from "../chit";
import { openReceiptChatWithImage, receiptImageSavedLocation, RECEIPT_SELECT, saveReceiptImageToDevice } from "../receipts";
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
  const [downloadAfterPreviewMount, setDownloadAfterPreviewMount] = useState(false);
  const [canUpdateCheque, setCanUpdateCheque] = useState(false);
  const imageRef = useRef<ViewShotRef>(null);

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
      const uri = await imageRef.current?.capture();
      if (!uri) throw new Error("Receipt image is not ready. Try again.");
      await saveReceiptImageToDevice(uri, r.receipt_no);
      setShareTarget(null);
      Alert.alert("Receipt saved", `The receipt image is in ${receiptImageSavedLocation()}.`);
    } catch (e) {
      Alert.alert(
        "Could not save receipt image",
        e instanceof Error ? e.message : String(e),
      );
    }
    setSharing("");
  };

  useEffect(() => {
    if (!shareTarget || !downloadAfterPreviewMount) return;
    setDownloadAfterPreviewMount(false);
    requestAnimationFrame(() => requestAnimationFrame(() => { void downloadReceiptImage(shareTarget); }));
  }, [shareTarget, downloadAfterPreviewMount]);

  const shareReceiptImage = async () => {
    if (!shareTarget) return;
    setSharing(shareTarget.id);
    try {
      const uri = await imageRef.current?.capture();
      if (!uri) throw new Error("Receipt image is not ready. Try again.");
      await openReceiptChatWithImage(uri, shareTarget, shareTarget.memberships?.customers?.phone);
      setShareTarget(null);
      Alert.alert("WhatsApp chat opened", `Receipt image saved in ${receiptImageSavedLocation()}. Attach it in this chat, then tap Send.`);
    } catch (e) {
      Alert.alert(
        "Could not open member chat",
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
                ? ` · Paper ${r.legacy_receipt_sources[0].paper_receipt_no || "—"}`
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
                  onPress={() => { setDownloadAfterPreviewMount(true); setShareTarget(r); }}
                >
                  <Text>{sharing === r.id ? "Saving…" : "Receipt ⬇️"}</Text>
                </TouchableOpacity>
              </View>
            )}
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
              disabled={sharing === shareTarget?.id}
              onPress={() => {
                void shareReceiptImage();
              }}
            >
              <Text style={st.bt}>
                {sharing === shareTarget?.id
                  ? "Preparing image…"
                  : "💬 Open member’s Chat"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.btn, { backgroundColor: "#2B1A6B", marginTop: 8 }]}
              disabled={sharing === shareTarget?.id}
              onPress={() => { if (shareTarget) void downloadReceiptImage(shareTarget); }}
            >
              <Text style={st.bt}>
                {sharing === shareTarget?.id ? "Saving…" : "Receipt ⬇️"}
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
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
