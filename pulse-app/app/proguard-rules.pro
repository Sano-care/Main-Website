# R8 keep-rules for the minified Pulse release build.
#
# Hilt, OkHttp, Compose, and Retrofit ship their own consumer R8 rules. The two
# things R8 full mode breaks without explicit rules are (1) kotlinx.serialization
# (synthetic serializer() / $serializer members) and (2) our Retrofit service
# interfaces + @Serializable DTOs. Both kept below (mirrors medic-app).

-keepattributes Signature, InnerClasses, EnclosingMethod
-keepattributes RuntimeVisibleAnnotations, RuntimeVisibleParameterAnnotations
-keepattributes AnnotationDefault

# ── kotlinx.serialization — official R8 keep block ──────────────────────────────
-if @kotlinx.serialization.Serializable class **
-keepclassmembers class <1> {
    static <1>$Companion Companion;
}
-if @kotlinx.serialization.Serializable class ** {
    static **$* *;
}
-keepclassmembers class <2>$<3> {
    kotlinx.serialization.KSerializer serializer(...);
}
-if @kotlinx.serialization.Serializable class ** {
    public static ** INSTANCE;
}
-keepclassmembers class <1> {
    public static <1> INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}

# ── Our @Serializable DTOs (the #1 break risk) ──────────────────────────────────
-keep class in.sanocare.pulse.data.network.** { *; }
-keepclassmembers class in.sanocare.pulse.data.network.** {
    *;
}

# ── Retrofit service interfaces ─────────────────────────────────────────────────
-keep,allowobfuscation interface in.sanocare.pulse.data.network.**
